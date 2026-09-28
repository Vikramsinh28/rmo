import { prisma } from '@/lib/prisma';
import { canAdminister, isRmoRole, type RmoRoleName } from '@/lib/rmo/access';
import { aiLog } from '@/lib/rmo/ai-log';
import { RmoError } from '@/lib/rmo/errors';
import { publishMonitoringEvent } from '@/lib/rmo/monitoring-events';
import { Actor } from '@/services/internal/rmo/administration';
import {
  Prisma,
  type SafetyEventOutcome,
  type SafetyEventSeverity,
  type SafetyEventStatus,
} from '@/lib/prisma/generated/client';

/** Visual indicators only — never a diagnosis. A human must review every event. */
const ALERT_STATUSES: readonly SafetyEventSeverity[] = ['ELEVATED_INDICATORS', 'HIGH_INDICATORS'];
const STATUSES: readonly SafetyEventStatus[] = [
  'PENDING_REVIEW',
  'CONFIRMED',
  'DISMISSED',
  'INCONCLUSIVE',
];
const OUTCOME_STATUS: Record<SafetyEventOutcome, SafetyEventStatus> = {
  IMPAIRMENT_CONFIRMED: 'CONFIRMED',
  NOT_IMPAIRED: 'DISMISSED',
  OTHER_CAUSE: 'DISMISSED',
  INSUFFICIENT_VIDEO: 'INCONCLUSIVE',
};
const MAX_NOTE_LENGTH = 2000;
const MISSING_TRACK_GRACE_MS = 10_000;

interface EpisodePayload {
  id?: string;
  active?: boolean;
  startedAt?: string;
  endedAt?: string | null;
  peakStatus?: string;
  peakScore?: number;
  peakConfidence?: number;
  evidence?: unknown;
  groups?: unknown;
  features?: unknown;
}

export interface SafetyPersonCandidate {
  trackId?: unknown;
  impairment?: {
    episode?: EpisodePayload | null;
    modelVersion?: string;
  } | null;
  identity?: {
    status?: string;
    userId?: number | null;
    displayName?: string | null;
    confidence?: number | null;
  } | null;
}

interface CachedEpisode {
  signature: string;
  trackId: string;
  open: boolean;
  lastSeenAt: number;
}

const episodeCache = new Map<number, Map<string, CachedEpisode>>();
const jobQueues = new Map<number, Promise<void>>();

function asRole(role: Actor['rmoRole']): RmoRoleName {
  if (!isRmoRole(role)) throw new RmoError('You do not have permission to perform this action.', 403);
  return role;
}

function isSeverity(value: unknown): value is SafetyEventSeverity {
  return typeof value === 'string' && (ALERT_STATUSES as readonly string[]).includes(value);
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

function publishSafety(
  type: 'safety.alert' | 'safety.escalated' | 'safety.reviewed',
  event: {
    id: number;
    divisionId: number;
    lobbyId: number;
    lobbyCallId: number;
    severity: string;
    status: string;
    trackId: string;
    subjectName: string | null;
    lobby?: { name: string } | null;
  },
) {
  publishMonitoringEvent({
    type,
    divisionId: event.divisionId,
    lobbyId: event.lobbyId,
    callId: event.lobbyCallId,
    safety: {
      eventId: event.id,
      severity: event.severity,
      status: event.status,
      trackId: event.trackId,
      subjectName: event.subjectName,
      lobbyName: event.lobby?.name ?? null,
    },
  });
}

function enqueue(jobId: number, task: () => Promise<void>) {
  const previous = jobQueues.get(jobId) || Promise.resolve();
  const next = previous.then(task).catch(error => {
    aiLog('SAFETY_EVENT_PERSIST_FAILED', {
      jobId,
      reason: error instanceof Error ? error.message : 'unknown',
    }, 'error');
  });
  jobQueues.set(jobId, next);
  return next;
}

interface RecordInput {
  jobId: number;
  callId: number;
  divisionId: number;
  lobbyId: number;
  persons: SafetyPersonCandidate[];
}

async function persistEpisodes(input: RecordInput) {
  const cache = episodeCache.get(input.jobId) || new Map<string, CachedEpisode>();
  episodeCache.set(input.jobId, cache);
  const now = Date.now();
  const seenTracks = new Set<string>();

  for (const person of input.persons) {
    const trackId = String(person.trackId || '');
    if (trackId) seenTracks.add(trackId);
    const episode = person.impairment?.episode;
    if (!trackId || !episode?.id || !isSeverity(episode.peakStatus)) continue;

    const identity = person.identity?.status === 'RECOGNIZED' ? person.identity : null;
    const subjectUserId = identity?.userId ?? null;
    const endedAt = toDate(episode.endedAt);
    const signature = [
      episode.peakStatus,
      Number(episode.peakScore || 0).toFixed(3),
      endedAt?.toISOString() || 'open',
      subjectUserId ?? '-',
    ].join('|');
    const cached = cache.get(episode.id);
    if (cached && cached.signature === signature) {
      cached.lastSeenAt = now;
      continue;
    }

    const fields = {
      severity: episode.peakStatus,
      peakScore: Number(episode.peakScore || 0),
      confidence: Number(episode.peakConfidence || 0),
      evidence: jsonValue(Array.isArray(episode.evidence) ? episode.evidence : []),
      signalGroups: jsonValue(episode.groups),
      featureWindow: jsonValue(episode.features),
      endedAt,
      ...(identity
        ? {
            subjectUserId,
            subjectName: identity.displayName ?? null,
            identityConfidence: identity.confidence ?? null,
          }
        : {}),
    };
    const key = { aiJobId: input.jobId, episodeKey: episode.id };
    const existing = await prisma.safetyEvent.findUnique({
      where: { aiJobId_episodeKey: key },
      select: { id: true, severity: true },
    });
    if (existing) {
      const updated = await prisma.safetyEvent.update({
        where: { id: existing.id },
        data: fields,
        include: { lobby: { select: { name: true } } },
      });
      if (existing.severity !== fields.severity) {
        publishSafety('safety.escalated', updated);
        aiLog('SAFETY_EVENT_ESCALATED', {
          safetyEventId: existing.id,
          jobId: input.jobId,
          from: existing.severity,
          to: fields.severity,
        });
      }
    } else {
      const created = await prisma.safetyEvent.create({
        data: {
          ...fields,
          ...key,
          divisionId: input.divisionId,
          lobbyId: input.lobbyId,
          lobbyCallId: input.callId,
          trackId,
          modelVersion: person.impairment?.modelVersion || 'unknown',
          startedAt: toDate(episode.startedAt) || new Date(),
        },
        include: { lobby: { select: { name: true } } },
      });
      publishSafety('safety.alert', created);
      await prisma.auditLog.create({
        data: {
          actorId: null,
          action: 'safety_event.created',
          targetType: 'safety_event',
          targetId: String(created.id),
          metadata: {
            callId: input.callId,
            divisionId: input.divisionId,
            lobbyId: input.lobbyId,
            aiJobId: input.jobId,
            severity: created.severity,
            modelVersion: created.modelVersion,
          },
        },
      });
      aiLog('SAFETY_EVENT_CREATED', {
        safetyEventId: created.id,
        jobId: input.jobId,
        callId: input.callId,
        severity: created.severity,
      });
    }
    cache.set(episode.id, { signature, trackId, open: !endedAt, lastSeenAt: now });
  }

  for (const [episodeKey, cached] of cache) {
    if (!cached.open || seenTracks.has(cached.trackId)) continue;
    if (now - cached.lastSeenAt < MISSING_TRACK_GRACE_MS) continue;
    await prisma.safetyEvent.updateMany({
      where: { aiJobId: input.jobId, episodeKey, endedAt: null },
      data: { endedAt: new Date(cached.lastSeenAt) },
    });
    cached.open = false;
    cached.signature = `${cached.signature}|lost`;
  }
}

/**
 * Persist ELEVATED/HIGH visual-indicator episodes from an AI frame response.
 * Runs off the frame request path and serialises writes per AI job.
 */
export function recordSafetyEpisodes(input: RecordInput) {
  return enqueue(input.jobId, () => persistEpisodes(input));
}

/** Close any open events for a job (AI stopped) and forget cached episode state. */
export async function closeSafetyEpisodes(jobId: number) {
  await (jobQueues.get(jobId) || Promise.resolve());
  jobQueues.delete(jobId);
  episodeCache.delete(jobId);
  await prisma.safetyEvent.updateMany({
    where: { aiJobId: jobId, endedAt: null },
    data: { endedAt: new Date() },
  });
}

/** Remove impairment output when the division is not entitled to it. */
export function stripImpairment<T extends Record<string, unknown>>(persons: T[]) {
  return persons.map(person => {
    const rest = { ...person } as Record<string, unknown>;
    delete rest.impairment;
    delete rest.visualStatus;
    return rest as T;
  });
}

function readScope(actor: Actor): Prisma.SafetyEventWhereInput {
  const role = asRole(actor.rmoRole);
  if (canAdminister(role) || role === 'SUPER_ADMIN') return {};
  if ((role === 'DIVISION_ADMIN' || role === 'DIVISION_MONITOR') && actor.homeDivisionId) {
    return { divisionId: actor.homeDivisionId };
  }
  throw new RmoError('You do not have permission to perform this action.', 403);
}

function assertCanReview(actor: Actor, divisionId: number) {
  const role = asRole(actor.rmoRole);
  if (canAdminister(role)) return;
  if (
    (role === 'DIVISION_ADMIN' || role === 'DIVISION_MONITOR')
    && actor.homeDivisionId === divisionId
  ) {
    return;
  }
  throw new RmoError('You do not have permission to review this safety event.', 403);
}

export interface SafetyEventListQuery {
  status?: string;
  severity?: string;
  divisionId?: number;
  lobbyId?: number;
  callId?: number;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

const listInclude = {
  division: { select: { id: true, code: true, name: true } },
  lobby: { select: { id: true, code: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
} satisfies Prisma.SafetyEventInclude;

type ListedEvent = Prisma.SafetyEventGetPayload<{ include: typeof listInclude }>;

function presentEvent(event: ListedEvent) {
  return {
    id: event.id,
    callId: event.lobbyCallId,
    aiJobId: event.aiJobId,
    episodeKey: event.episodeKey,
    trackId: event.trackId,
    division: event.division,
    lobby: event.lobby,
    subject: event.subjectUserId || event.subjectName
      ? {
          userId: event.subjectUserId,
          name: event.subjectName,
          confidence: event.identityConfidence,
        }
      : null,
    severity: event.severity,
    peakScore: event.peakScore,
    confidence: event.confidence,
    evidence: event.evidence,
    signalGroups: event.signalGroups,
    modelVersion: event.modelVersion,
    status: event.status,
    startedAt: event.startedAt.toISOString(),
    endedAt: event.endedAt?.toISOString() || null,
    review: event.reviewedAt
      ? {
          outcome: event.reviewOutcome,
          note: event.reviewNote,
          breathTestPerformed: event.breathTestPerformed,
          breathTestPositive: event.breathTestPositive,
          reviewedBy: event.reviewedBy,
          reviewedAt: event.reviewedAt.toISOString(),
        }
      : null,
    createdAt: event.createdAt.toISOString(),
  };
}

export async function listSafetyEvents(actor: Actor, query: SafetyEventListQuery) {
  const scope = readScope(actor);
  const page = Math.max(query.page || 1, 1);
  const pageSize = Math.min(Math.max(query.pageSize || 20, 1), 50);
  const status = STATUSES.find(value => value === query.status);
  const severity = ALERT_STATUSES.find(value => value === query.severity);
  const dateFrom = toDate(query.dateFrom);
  const dateTo = toDate(query.dateTo);
  const where: Prisma.SafetyEventWhereInput = {
    AND: [
      scope,
      status ? { status } : {},
      severity ? { severity } : {},
      query.divisionId ? { divisionId: query.divisionId } : {},
      query.lobbyId ? { lobbyId: query.lobbyId } : {},
      query.callId ? { lobbyCallId: query.callId } : {},
      query.search
        ? {
            OR: [
              { subjectName: { contains: query.search, mode: 'insensitive' } },
              { trackId: { contains: query.search, mode: 'insensitive' } },
              { lobby: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {},
      dateFrom || dateTo
        ? {
            startedAt: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {},
    ],
  };
  const [items, total, pending] = await Promise.all([
    prisma.safetyEvent.findMany({
      where,
      include: listInclude,
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.safetyEvent.count({ where }),
    prisma.safetyEvent.count({ where: { AND: [scope, { status: 'PENDING_REVIEW' }] } }),
  ]);
  return { items: items.map(presentEvent), total, page, pageSize, pending };
}

async function loadEventForActor(actor: Actor, id: number) {
  if (!Number.isInteger(id) || id <= 0) throw new RmoError('Safety event not found.', 404);
  const event = await prisma.safetyEvent.findFirst({
    where: { AND: [readScope(actor), { id }] },
    include: listInclude,
  });
  if (!event) throw new RmoError('Safety event not found.', 404);
  return event;
}

export async function getSafetyEvent(actor: Actor, id: number) {
  const event = await loadEventForActor(actor, id);
  return { ...presentEvent(event), featureWindow: event.featureWindow };
}

export interface SafetyEventReviewInput {
  outcome?: unknown;
  note?: unknown;
  breathTestPerformed?: unknown;
  breathTestPositive?: unknown;
}

export async function reviewSafetyEvent(actor: Actor, id: number, input: SafetyEventReviewInput) {
  const event = await loadEventForActor(actor, id);
  assertCanReview(actor, event.divisionId);

  const outcome = typeof input.outcome === 'string' && input.outcome in OUTCOME_STATUS
    ? input.outcome as SafetyEventOutcome
    : null;
  if (!outcome) throw new RmoError('Choose a review outcome.', 400, 'INVALID_OUTCOME');
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length > MAX_NOTE_LENGTH) {
    throw new RmoError(`Review note must be ${MAX_NOTE_LENGTH} characters or fewer.`, 400);
  }
  if (outcome === 'IMPAIRMENT_CONFIRMED' && !note) {
    throw new RmoError('Add a note describing how impairment was confirmed.', 400);
  }
  const breathTestPerformed = input.breathTestPerformed === true;
  if (input.breathTestPositive != null && typeof input.breathTestPositive !== 'boolean') {
    throw new RmoError('Breath test result must be true or false.', 400);
  }
  const breathTestPositive = breathTestPerformed
    ? (input.breathTestPositive as boolean | null | undefined) ?? null
    : null;

  const updated = await prisma.safetyEvent.update({
    where: { id: event.id },
    data: {
      status: OUTCOME_STATUS[outcome],
      reviewOutcome: outcome,
      reviewNote: note || null,
      breathTestPerformed,
      breathTestPositive,
      reviewedById: actor.id,
      reviewedAt: new Date(),
    },
    include: listInclude,
  });
  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: 'safety_event.reviewed',
      targetType: 'safety_event',
      targetId: String(event.id),
      metadata: {
        divisionId: event.divisionId,
        lobbyId: event.lobbyId,
        callId: event.lobbyCallId,
        previousStatus: event.status,
        status: updated.status,
        outcome,
        breathTestPerformed,
        breathTestPositive,
      },
    },
  });
  publishSafety('safety.reviewed', { ...updated, lobby: updated.lobby });
  return { ...presentEvent(updated), featureWindow: updated.featureWindow };
}

/** @internal test helper — waits for queued episode writes. */
export async function flushSafetyEpisodesForTests() {
  await Promise.all(jobQueues.values());
}

/** @internal test helper */
export function resetSafetyEpisodeCacheForTests() {
  episodeCache.clear();
  jobQueues.clear();
}
