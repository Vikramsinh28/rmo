import { prisma } from '@/lib/prisma';
import { aiLog } from '@/lib/rmo/ai-log';
import { assertDivisionAIFeature } from '@/services/internal/rmo/ai-entitlement';
import { recordAudit } from '@/services/internal/rmo/audit-event';
import { RmoError } from '@/lib/rmo/errors';
import { cropFaceJpeg } from '@/services/external/aws/rekognition';
import { getIdentityResolutionProvider } from '@/services/internal/rmo/identity-provider';
import {
  evaluateIdentityQualityGate,
  type FaceBoxNorm,
} from '@/services/internal/rmo/identity-quality-gate';

export type TrackIdentityStatus =
  | 'UNKNOWN'
  | 'CHECKING'
  | 'RECOGNIZED'
  | 'REJECTED'
  | 'UNAVAILABLE';

export interface TrackIdentityState {
  trackId: string;
  identityStatus: TrackIdentityStatus;
  userId: number | null;
  displayName: string | null;
  confidence: number | null;
  lastIdentityCheckAt: number | null;
  lastIdentitySuccessAt: number | null;
  identityAttempts: number;
  identityQuality: number | null;
  identityReason: string | null;
  missedConfirmations: number;
  pendingUserId: number | null;
  pendingConfirmations: number;
}

export interface SessionIdentityMetrics {
  enabled: boolean;
  provider: string;
  requestCount: number;
  recognizedCount: number;
  unknownCount: number;
  errorCount: number;
  skippedQuality: number;
  skippedCooldown: number;
  skippedLimit: number;
  candidates: number;
  awsAvailable: boolean;
}

interface SessionIdentityStore {
  callId: number;
  divisionId: number;
  requestCount: number;
  recognizedCount: number;
  unknownCount: number;
  errorCount: number;
  skippedQuality: number;
  skippedCooldown: number;
  skippedLimit: number;
  candidates: number;
  concurrent: number;
  tracks: Map<string, TrackIdentityState>;
}

export interface TrackedPersonCandidate {
  trackId: string;
  face?: {
    visible?: boolean | null;
    quality?: number | null;
    boundingBox?: FaceBoxNorm | null;
  };
  quality?: { score?: number | null };
  tracking?: {
    boundingBox?: FaceBoxNorm | null;
  };
}

const sessions = new Map<number, SessionIdentityStore>();

function envBool(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? value : fallback;
}

export function identityResolutionEnabled() {
  return envBool('IDENTITY_RESOLUTION_ENABLED', true);
}

export function identityCooldownMs() {
  return Math.max(0, envNumber('IDENTITY_RESOLUTION_COOLDOWN_MS', 15_000));
}

export function identityMinMatchConfidence() {
  return Math.min(100, Math.max(1, envNumber('IDENTITY_RESOLUTION_MIN_MATCH_CONFIDENCE', 90)));
}

export function identityMaxFacesPerRequest() {
  return Math.max(1, envNumber('IDENTITY_RESOLUTION_MAX_FACES_PER_REQUEST', 5));
}

export function identityMaxRequestsPerSession() {
  return Math.max(1, envNumber('IDENTITY_RESOLUTION_MAX_REQUESTS_PER_SESSION', 100));
}

export function identityMaxConcurrent() {
  return Math.max(1, envNumber('IDENTITY_MAX_CONCURRENT_REQUESTS', 2));
}

export function identityMaxMissedConfirmations() {
  return Math.max(1, envNumber('IDENTITY_MAX_MISSED_CONFIRMATIONS', 3));
}

export function identityProviderName() {
  const value = (process.env.IDENTITY_RESOLUTION_PROVIDER || 'aws').trim().toLowerCase();
  return value === 'mock' ? 'mock' : 'aws';
}

function ensureSession(callId: number, divisionId: number): SessionIdentityStore {
  let session = sessions.get(callId);
  if (!session) {
    session = {
      callId,
      divisionId,
      requestCount: 0,
      recognizedCount: 0,
      unknownCount: 0,
      errorCount: 0,
      skippedQuality: 0,
      skippedCooldown: 0,
      skippedLimit: 0,
      candidates: 0,
      concurrent: 0,
      tracks: new Map(),
    };
    sessions.set(callId, session);
  }
  session.divisionId = divisionId;
  return session;
}

function ensureTrack(session: SessionIdentityStore, trackId: string): TrackIdentityState {
  let track = session.tracks.get(trackId);
  if (!track) {
    track = {
      trackId,
      identityStatus: 'UNKNOWN',
      userId: null,
      displayName: null,
      confidence: null,
      lastIdentityCheckAt: null,
      lastIdentitySuccessAt: null,
      identityAttempts: 0,
      identityQuality: null,
      identityReason: null,
      missedConfirmations: 0,
      pendingUserId: null,
      pendingConfirmations: 0,
    };
    session.tracks.set(trackId, track);
  }
  return track;
}

export function clearIdentitySession(callId: number) {
  sessions.delete(callId);
}

export function getSessionIdentityMetrics(callId: number): SessionIdentityMetrics {
  const session = sessions.get(callId);
  const provider = identityProviderName();
  return {
    enabled: identityResolutionEnabled(),
    provider,
    requestCount: session?.requestCount || 0,
    recognizedCount: session?.recognizedCount || 0,
    unknownCount: session?.unknownCount || 0,
    errorCount: session?.errorCount || 0,
    skippedQuality: session?.skippedQuality || 0,
    skippedCooldown: session?.skippedCooldown || 0,
    skippedLimit: session?.skippedLimit || 0,
    candidates: session?.candidates || 0,
    awsAvailable: provider === 'mock' || Boolean(process.env.AWS_ACCESS_KEY_ID),
  };
}

export function getTrackIdentityOverlay(callId: number): Map<string, TrackIdentityState> {
  return sessions.get(callId)?.tracks || new Map();
}

function confidenceBucket(confidence: number | null) {
  if (confidence == null) return null;
  if (confidence >= 95) return '95+';
  if (confidence >= 90) return '90-94';
  if (confidence >= 80) return '80-89';
  return 'below-80';
}

async function resolveEnrollmentMatch(
  faceId: string,
  confidence: number,
  divisionId: number,
  threshold: number,
) {
  if (confidence < threshold) {
    return { status: 'UNKNOWN' as const, userId: null, displayName: null, confidence: null };
  }
  const enrollment = await prisma.userFaceEnrollment.findFirst({
    where: {
      providerFaceId: faceId,
      status: 'ENROLLED',
      divisionId,
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          rmoRole: true,
          accountStatus: true,
          homeDivisionId: true,
          deletedAt: true,
        },
      },
    },
  });
  const user = enrollment?.user;
  if (
    !user
    || user.deletedAt
    || user.accountStatus !== 'ACTIVE'
    || user.rmoRole !== 'CREW_USER'
    || user.homeDivisionId !== divisionId
  ) {
    return { status: 'UNKNOWN' as const, userId: null, displayName: null, confidence: null };
  }
  return {
    status: 'RECOGNIZED' as const,
    userId: user.id,
    displayName: user.name,
    confidence,
  };
}

export async function resolveTrackedPersonIdentity(input: {
  callId: number;
  divisionId: number;
  actorId: number;
  trackId: string;
  faceImage: Buffer;
  qualityScore: number | null;
}) {
  const session = ensureSession(input.callId, input.divisionId);
  const track = ensureTrack(session, input.trackId);

  try {
    await assertDivisionAIFeature(input.divisionId, 'faceIdentification');
  } catch (error) {
    track.identityStatus = 'UNAVAILABLE';
    track.identityReason = 'FACE_IDENTIFICATION_NOT_ENABLED';
    if (error instanceof RmoError) {
      throw new RmoError(
        'Face identification is not enabled for this division.',
        403,
        'FACE_IDENTIFICATION_NOT_ENABLED',
      );
    }
    throw error;
  }

  const collection = await prisma.divisionFaceCollection.findUnique({
    where: { divisionId: input.divisionId },
  });
  if (!collection) {
    track.identityStatus = 'UNAVAILABLE';
    track.identityReason = 'COLLECTION_MISSING';
    session.errorCount += 1;
    await recordAudit(input.actorId, 'identity_resolution.failed', 'lobby_call', input.callId, {
      callId: input.callId,
      divisionId: input.divisionId,
      trackId: input.trackId,
      reason: 'COLLECTION_MISSING',
    });
    return {
      status: 'UNAVAILABLE' as const,
      userId: null,
      displayName: null,
      confidence: null,
    };
  }

  track.identityStatus = track.identityStatus === 'RECOGNIZED' ? 'RECOGNIZED' : 'CHECKING';
  track.lastIdentityCheckAt = Date.now();
  track.identityAttempts += 1;
  track.identityQuality = input.qualityScore;
  session.requestCount += 1;

  await recordAudit(input.actorId, 'identity_resolution.requested', 'lobby_call', input.callId, {
    callId: input.callId,
    divisionId: input.divisionId,
    trackId: input.trackId,
    qualityBucket: input.qualityScore != null && input.qualityScore >= 0.7 ? 'good' : 'fair',
  });

  if (identityProviderName() === 'mock') {
    // Keep Phase 8 mock face search env consistent when tests set mock identity.
    process.env.FACE_RECOGNITION_PROVIDER = 'mock';
  }

  try {
    const provider = getIdentityResolutionProvider();
    const mockResult = (process.env.MOCK_IDENTITY_RESULT || '').toLowerCase();
    if (provider.name === 'mock' && mockResult === 'unavailable') {
      throw Object.assign(new Error('Mock identity unavailable'), { name: 'AwsNotConfigured' });
    }
    if (provider.name === 'mock' && mockResult === 'unknown') {
      session.unknownCount += 1;
      applyUnknown(track);
      await recordAudit(input.actorId, 'identity_resolution.unknown', 'lobby_call', input.callId, {
        callId: input.callId,
        divisionId: input.divisionId,
        trackId: input.trackId,
        reason: 'MOCK_UNKNOWN',
        provider: provider.name,
      });
      return {
        status: 'UNKNOWN' as const,
        userId: null,
        displayName: null,
        confidence: null,
      };
    }

    const match = await provider.searchFace({
      collectionId: collection.collectionId,
      imageBytes: input.faceImage,
      threshold: identityMinMatchConfidence(),
    });

    if (!match) {
      session.unknownCount += 1;
      applyUnknown(track);
      await recordAudit(input.actorId, 'identity_resolution.unknown', 'lobby_call', input.callId, {
        callId: input.callId,
        divisionId: input.divisionId,
        trackId: input.trackId,
        reason: 'NO_MATCH',
      });
      return {
        status: 'UNKNOWN' as const,
        userId: null,
        displayName: null,
        confidence: null,
      };
    }

    const resolved = await resolveEnrollmentMatch(
      match.faceId,
      match.confidence,
      input.divisionId,
      identityMinMatchConfidence(),
    );

    if (resolved.status === 'RECOGNIZED' && resolved.userId != null) {
      applyRecognized(track, resolved);
      session.recognizedCount += 1;
      await recordAudit(input.actorId, 'identity_resolution.recognized', 'lobby_call', input.callId, {
        callId: input.callId,
        divisionId: input.divisionId,
        trackId: input.trackId,
        userId: resolved.userId,
        confidenceBucket: confidenceBucket(resolved.confidence),
      });
      return resolved;
    }

    session.unknownCount += 1;
    applyUnknown(track);
    await recordAudit(input.actorId, 'identity_resolution.unknown', 'lobby_call', input.callId, {
      callId: input.callId,
      divisionId: input.divisionId,
      trackId: input.trackId,
      reason: 'BELOW_THRESHOLD_OR_NO_ENROLLMENT',
      confidenceBucket: confidenceBucket(match.confidence),
    });
    return {
      status: 'UNKNOWN' as const,
      userId: null,
      displayName: null,
      confidence: null,
    };
  } catch (error) {
    session.errorCount += 1;
    track.identityStatus = 'UNAVAILABLE';
    track.identityReason = error instanceof Error ? error.name : 'unknown';
    await recordAudit(input.actorId, 'identity_resolution.failed', 'lobby_call', input.callId, {
      callId: input.callId,
      divisionId: input.divisionId,
      trackId: input.trackId,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    aiLog('IDENTITY_RESOLUTION_FAILED', {
      callId: input.callId,
      trackId: input.trackId,
      liveCallAffected: false,
      reason: error instanceof Error ? error.name : 'unknown',
    }, 'warn');
    return {
      status: 'UNAVAILABLE' as const,
      userId: null,
      displayName: null,
      confidence: null,
    };
  }
}

function applyRecognized(
  track: TrackIdentityState,
  resolved: { userId: number; displayName: string | null; confidence: number | null },
) {
  // Conflicting identity requires extra confirmations before switching.
  if (
    track.identityStatus === 'RECOGNIZED'
    && track.userId != null
    && track.userId !== resolved.userId
  ) {
    if (track.pendingUserId !== resolved.userId) {
      track.pendingUserId = resolved.userId;
      track.pendingConfirmations = 1;
      return;
    }
    track.pendingConfirmations += 1;
    if (track.pendingConfirmations < 2) return;
  }

  track.identityStatus = 'RECOGNIZED';
  track.userId = resolved.userId;
  track.displayName = resolved.displayName;
  track.confidence = resolved.confidence;
  track.lastIdentitySuccessAt = Date.now();
  track.missedConfirmations = 0;
  track.pendingUserId = null;
  track.pendingConfirmations = 0;
  track.identityReason = 'RECOGNIZED';
}

function applyUnknown(track: TrackIdentityState) {
  if (track.identityStatus === 'RECOGNIZED' && track.userId != null) {
    track.missedConfirmations += 1;
    if (track.missedConfirmations < identityMaxMissedConfirmations()) {
      track.identityReason = 'TEMPORARY_MISS';
      return;
    }
  }
  track.identityStatus = 'UNKNOWN';
  track.userId = null;
  track.displayName = null;
  track.confidence = null;
  track.identityReason = 'UNKNOWN';
  track.missedConfirmations = 0;
  track.pendingUserId = null;
  track.pendingConfirmations = 0;
}

/**
 * Non-blocking identity scheduler. Must never delay frame ingestion.
 */
export function scheduleIdentityResolution(input: {
  callId: number;
  divisionId: number;
  actorId: number;
  frame: Buffer;
  persons: TrackedPersonCandidate[];
}) {
  if (!identityResolutionEnabled()) return;
  void processIdentityCandidates(input).catch(error => {
    aiLog('IDENTITY_SCHEDULER_ERROR', {
      callId: input.callId,
      liveCallAffected: false,
      reason: error instanceof Error ? error.name : 'unknown',
    }, 'warn');
  });
}

async function processIdentityCandidates(input: {
  callId: number;
  divisionId: number;
  actorId: number;
  frame: Buffer;
  persons: TrackedPersonCandidate[];
}) {
  if (!identityResolutionEnabled()) {
    for (const person of input.persons) {
      const track = ensureTrack(ensureSession(input.callId, input.divisionId), person.trackId);
      track.identityReason = 'FEATURE_DISABLED';
    }
    return;
  }

  const session = ensureSession(input.callId, input.divisionId);
  session.candidates += input.persons.length;

  // Drop tracks no longer present in the rolling window response.
  const active = new Set(input.persons.map(person => person.trackId));
  for (const trackId of session.tracks.keys()) {
    if (!active.has(trackId)) session.tracks.delete(trackId);
  }

  try {
    await assertDivisionAIFeature(input.divisionId, 'faceIdentification');
  } catch {
    for (const person of input.persons) {
      const track = ensureTrack(session, person.trackId);
      // Keep tracking; stop new AWS lookups when entitlement is off.
      if (track.identityStatus !== 'RECOGNIZED') {
        track.identityStatus = 'UNKNOWN';
      }
      track.identityReason = 'ENTITLEMENT_DISABLED';
    }
    return;
  }

  const now = Date.now();
  const cooldown = identityCooldownMs();
  const maxFaces = identityMaxFacesPerRequest();
  const maxRequests = identityMaxRequestsPerSession();
  const maxConcurrent = identityMaxConcurrent();
  const eligible: Array<{
    person: TrackedPersonCandidate;
    qualityScore: number;
    box: FaceBoxNorm;
  }> = [];

  for (const person of input.persons) {
    const track = ensureTrack(session, person.trackId);
    const gate = evaluateIdentityQualityGate({
      faceVisible: person.face?.visible,
      faceQuality: person.face?.quality,
      faceBox: person.face?.boundingBox || null,
      personQualityScore: person.quality?.score,
    });
    track.identityQuality = gate.qualityScore;

    if (!gate.eligible || !person.face?.boundingBox) {
      track.identityReason = gate.reason;
      session.skippedQuality += 1;
      continue;
    }
    if (track.identityStatus === 'RECOGNIZED' && track.userId != null && track.missedConfirmations === 0) {
      track.identityReason = 'ALREADY_RECOGNIZED';
      continue;
    }
    if (track.lastIdentityCheckAt && now - track.lastIdentityCheckAt < cooldown) {
      track.identityReason = 'COOLDOWN';
      session.skippedCooldown += 1;
      continue;
    }
    if (session.requestCount >= maxRequests) {
      track.identityReason = 'SESSION_LIMIT';
      session.skippedLimit += 1;
      continue;
    }
    eligible.push({
      person,
      qualityScore: gate.qualityScore ?? 0,
      box: person.face.boundingBox,
    });
  }

  // Prefer highest-quality faces first; cap per frame.
  eligible.sort((a, b) => b.qualityScore - a.qualityScore);
  const selected = eligible.slice(0, maxFaces);
  for (const skipped of eligible.slice(maxFaces)) {
    const track = ensureTrack(session, skipped.person.trackId);
    track.identityReason = 'MAX_FACES_PER_FRAME';
  }

  if (session.requestCount >= maxRequests) {
    await recordAudit(input.actorId, 'identity_resolution.limit_reached', 'lobby_call', input.callId, {
      callId: input.callId,
      divisionId: input.divisionId,
      requestCount: session.requestCount,
      limit: maxRequests,
    });
  }

  for (const item of selected) {
    if (session.concurrent >= maxConcurrent) {
      const track = ensureTrack(session, item.person.trackId);
      track.identityReason = 'CONCURRENCY_LIMIT';
      session.skippedLimit += 1;
      continue;
    }
    if (session.requestCount >= maxRequests) {
      const track = ensureTrack(session, item.person.trackId);
      track.identityReason = 'SESSION_LIMIT';
      session.skippedLimit += 1;
      break;
    }

    session.concurrent += 1;
    try {
      const crop = await cropFaceJpeg(input.frame, {
        left: item.box.x,
        top: item.box.y,
        width: item.box.width,
        height: item.box.height,
      });
      if (!crop.length || crop.byteLength < 100) {
        session.skippedQuality += 1;
        const track = ensureTrack(session, item.person.trackId);
        track.identityReason = 'INVALID_CROP';
        continue;
      }
      await resolveTrackedPersonIdentity({
        callId: input.callId,
        divisionId: input.divisionId,
        actorId: input.actorId,
        trackId: item.person.trackId,
        faceImage: crop,
        qualityScore: item.qualityScore,
      });
    } catch (error) {
      // Never let identity failures interrupt tracking / WebRTC.
      aiLog('IDENTITY_CANDIDATE_ERROR', {
        callId: input.callId,
        trackId: item.person.trackId,
        liveCallAffected: false,
        reason: error instanceof Error ? error.name : 'unknown',
      }, 'warn');
    } finally {
      session.concurrent = Math.max(0, session.concurrent - 1);
    }
  }
}

/** Merge temporary track identity overlay onto AI tracking persons for the UI. */
export function mergeIdentityIntoPersons(
  callId: number,
  persons: Array<Record<string, unknown>>,
) {
  const overlay = getTrackIdentityOverlay(callId);
  return persons.map(person => {
    const trackId = String(person.trackId || '');
    const state = overlay.get(trackId);
    if (!state) return person;
    const identity = {
      status: state.identityStatus === 'RECOGNIZED' ? 'RECOGNIZED' : (
        state.identityStatus === 'CHECKING' ? 'CHECKING'
          : state.identityStatus === 'UNAVAILABLE' ? 'UNAVAILABLE'
            : 'UNKNOWN'
      ),
      displayName: state.displayName,
      userId: state.userId,
      confidence: state.confidence,
      reason: state.identityReason,
      lastCheckedAt: state.lastIdentityCheckAt
        ? new Date(state.lastIdentityCheckAt).toISOString()
        : null,
    };
    return {
      ...person,
      identity,
      identityStatus: state.identityStatus,
    };
  });
}

/** @internal test helper — runs the async identity candidate processor. */
export async function processIdentityCandidatesForTests(input: {
  callId: number;
  divisionId: number;
  actorId: number;
  frame: Buffer;
  persons: TrackedPersonCandidate[];
}) {
  return processIdentityCandidates(input);
}

/** @internal test helper — simulate occupied concurrency slots. */
export function setSessionConcurrentForTests(callId: number, divisionId: number, concurrent: number) {
  const session = ensureSession(callId, divisionId);
  session.concurrent = Math.max(0, concurrent);
}

/** @internal test helper — seed a recognized track for stability tests. */
export function seedRecognizedTrackForTests(input: {
  callId: number;
  divisionId: number;
  trackId: string;
  userId: number;
  displayName: string;
  confidence?: number;
}) {
  const session = ensureSession(input.callId, input.divisionId);
  const track = ensureTrack(session, input.trackId);
  track.identityStatus = 'RECOGNIZED';
  track.userId = input.userId;
  track.displayName = input.displayName;
  track.confidence = input.confidence ?? 96;
  track.lastIdentitySuccessAt = Date.now();
  track.lastIdentityCheckAt = Date.now();
  track.missedConfirmations = 0;
  track.identityReason = 'RECOGNIZED';
  return track;
}
