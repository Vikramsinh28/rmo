import { prisma } from '@/lib/prisma';
import { canAdminister, isRmoRole, type RmoRoleName } from '@/lib/rmo/access';
import { aiLog } from '@/lib/rmo/ai-log';
import { RmoError } from '@/lib/rmo/errors';
import { getDivisionAICapabilities } from '@/services/internal/rmo/ai-entitlement';
import { Actor } from '@/services/internal/rmo/administration';
import { AIProcessingStatus } from '@/lib/prisma/generated/client';
import {
  clearIdentitySession,
  getSessionIdentityMetrics,
  mergeIdentityIntoPersons,
  scheduleIdentityResolution,
  type TrackedPersonCandidate,
} from '@/services/internal/rmo/identity-resolution';
import {
  closeSafetyEpisodes,
  recordSafetyEpisodes,
  stripImpairment,
  type SafetyPersonCandidate,
} from '@/services/internal/rmo/safety-events';

const OPEN_STATUSES: AIProcessingStatus[] = ['STARTING', 'RUNNING', 'STOPPING'];

function asRole(role: Actor['rmoRole']): RmoRoleName {
  if (!isRmoRole(role)) throw new RmoError('You do not have permission to perform this action.', 403);
  return role;
}

function aiServiceBase() {
  return (process.env.AI_SERVICE_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');
}

function aiServiceToken() {
  return process.env.AI_SERVICE_TOKEN || 'local-ai-service-token';
}

async function aiFetch(path: string, init?: RequestInit) {
  const started = Date.now();
  try {
    const response = await fetch(`${aiServiceBase()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${aiServiceToken()}`,
        ...(init?.headers || {}),
      },
      signal: AbortSignal.timeout(8_000),
    });
    aiLog('AI_SERVICE_HTTP', {
      path,
      method: init?.method || 'GET',
      status: response.status,
      ms: Date.now() - started,
    });
    return response;
  } catch (error) {
    aiLog('AI_SERVICE_HTTP_ERROR', {
      path,
      method: init?.method || 'GET',
      ms: Date.now() - started,
      reason: error instanceof Error ? error.message : 'unknown',
    }, 'warn');
    throw error;
  }
}

async function loadCallForActor(actor: Actor, callId: number) {
  const call = await prisma.lobbyCall.findUnique({
    where: { id: callId },
    select: {
      id: true,
      status: true,
      divisionId: true,
      lobbyId: true,
      monitorUserId: true,
      lobby: { select: { name: true } },
    },
  });
  if (!call) throw new RmoError('Call not found.', 404);
  const role = asRole(actor.rmoRole);
  const allowed =
    canAdminister(role)
    || role === 'SUPER_ADMIN'
    || (role === 'DIVISION_ADMIN' && actor.homeDivisionId === call.divisionId)
    || (role === 'DIVISION_MONITOR' && (
      actor.homeDivisionId === call.divisionId || actor.id === call.monitorUserId
    ))
    || (role === 'LOBBY_USER' && actor.homeLobbyId === call.lobbyId);
  if (!allowed) {
    throw new RmoError('You do not have permission to perform this action.', 403);
  }
  return call;
}

function presentJob(job: {
  id: number;
  lobbyCallId: number;
  divisionId: number;
  lobbyId: number;
  status: AIProcessingStatus;
  framesReceived: number;
  framesProcessed: number;
  processingFps: number | null;
  lastFrameAt: Date | null;
  errorMessage: string | null;
  startedAt: Date;
  stoppedAt: Date | null;
}) {
  return {
    id: job.id,
    callId: job.lobbyCallId,
    divisionId: job.divisionId,
    lobbyId: job.lobbyId,
    status: job.status,
    framesReceived: job.framesReceived,
    framesProcessed: job.framesProcessed,
    processingFps: job.processingFps,
    lastFrameAt: job.lastFrameAt?.toISOString() || null,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt.toISOString(),
    stoppedAt: job.stoppedAt?.toISOString() || null,
  };
}

export interface LiveOverlayPerson {
  trackId: string;
  box: { x: number; y: number; width: number; height: number } | null;
  name: string | null;
  identityStatus: string | null;
  visualStatus: string | null;
}

function numberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Minimal per-person view for drawing boxes over the live video (normalized 0–1 coords). */
function buildLiveOverlay(
  persons: Array<Record<string, unknown>>,
  includeVisualStatus: boolean,
): LiveOverlayPerson[] {
  return persons.map(person => {
    const tracking = (person.tracking || {}) as Record<string, unknown>;
    const raw = (tracking.boundingBox || {}) as Record<string, unknown>;
    const x = numberOrNull(raw.x);
    const y = numberOrNull(raw.y);
    const width = numberOrNull(raw.width);
    const height = numberOrNull(raw.height);
    const identity = (person.identity || {}) as Record<string, unknown>;
    const impairment = (person.impairment || {}) as Record<string, unknown>;
    const visual = person.visualStatus ?? impairment.status;
    return {
      trackId: String(person.trackId ?? ''),
      box: x != null && y != null && width != null && height != null
        ? { x, y, width, height }
        : null,
      name: typeof identity.displayName === 'string' ? identity.displayName : null,
      identityStatus: typeof identity.status === 'string' ? identity.status : null,
      visualStatus: includeVisualStatus && typeof visual === 'string' ? visual : null,
    };
  });
}

async function syncFromAiService(jobId: number) {
  try {
    const response = await aiFetch(`/sessions/${jobId}/status`);
    if (!response.ok) return null;
    const body = await response.json() as {
      framesReceived?: number;
      framesProcessed?: number;
      processingFps?: number;
      lastFrameAt?: string | null;
      status?: string;
      personCount?: number;
      persons?: unknown[];
      tracking?: unknown;
      safety?: unknown;
    };
    const updated = await prisma.aIProcessingJob.update({
      where: { id: jobId },
      data: {
        framesReceived: body.framesReceived ?? undefined,
        framesProcessed: body.framesProcessed ?? undefined,
        processingFps: body.processingFps ?? undefined,
        lastFrameAt: body.lastFrameAt ? new Date(body.lastFrameAt) : undefined,
      },
    });
    return {
      job: updated,
      persons: Array.isArray(body.persons) ? body.persons : [],
      personCount: typeof body.personCount === 'number' ? body.personCount : 0,
      tracking: body.tracking || null,
      safety: body.safety || null,
    };
  } catch {
    return null;
  }
}

export async function getCallAIProcessingStatus(actor: Actor, callId: number) {
  const call = await loadCallForActor(actor, callId);
  const capabilities = await getDivisionAICapabilities(call.divisionId);
  const job = await prisma.aIProcessingJob.findFirst({
    where: {
      lobbyCallId: callId,
      status: { in: OPEN_STATUSES },
    },
    orderBy: { id: 'desc' },
  });
  let current = job;
  let persons: unknown[] = [];
  let personCount = 0;
  let tracking: unknown = null;
  let safety: unknown = null;
  if (job && job.status === 'RUNNING') {
    const synced = await syncFromAiService(job.id);
    if (synced) {
      current = synced.job;
      const merged = mergeIdentityIntoPersons(
        callId,
        (synced.persons as Array<Record<string, unknown>>) || [],
      );
      persons = capabilities.features.impairmentDetection ? merged : stripImpairment(merged);
      personCount = Array.isArray(persons) ? persons.length : synced.personCount;
      tracking = synced.tracking;
      safety = synced.safety;
    }
  }
  const everStarted = current
    ? true
    : (await prisma.aIProcessingJob.count({ where: { lobbyCallId: callId } })) > 0;
  return {
    callId: call.id,
    callStatus: call.status,
    divisionId: call.divisionId,
    everStarted,
    ai: {
      enabled: capabilities.available,
      reason: capabilities.reason,
      features: capabilities.features,
      moduleNote: capabilities.moduleNote,
    },
    processing: current ? presentJob(current) : null,
    // Phase 10/11 — temporary tracking IDs + quality-gated identity overlay.
    people: {
      count: personCount,
      persons,
      tracking,
    },
    // Temporal safety counters (in-memory AI session). Not alcohol diagnosis.
    safety,
    identityResolution: getSessionIdentityMetrics(callId),
    identityRequestCount: getSessionIdentityMetrics(callId).requestCount,
  };
}

export async function startCallAIProcessing(actor: Actor, callId: number) {
  const role = asRole(actor.rmoRole);
  if (role !== 'DIVISION_MONITOR' && !canAdminister(role)) {
    throw new RmoError('Only a division monitor can start AI processing.', 403);
  }
  const call = await loadCallForActor(actor, callId);
  if (call.status !== 'CONNECTED') {
    throw new RmoError('AI processing can only start on a connected live call.', 409);
  }
  if (role === 'DIVISION_MONITOR' && actor.id !== call.monitorUserId && actor.homeDivisionId !== call.divisionId) {
    throw new RmoError('You do not have permission to perform this action.', 403);
  }
  if (role === 'DIVISION_MONITOR' && actor.homeDivisionId !== call.divisionId) {
    throw new RmoError('You cannot start AI processing for another division.', 403);
  }

  const capabilities = await getDivisionAICapabilities(call.divisionId);
  if (!capabilities.available) {
    aiLog('AI_START_DENIED', {
      callId,
      divisionId: call.divisionId,
      actorId: actor.id,
      reason: capabilities.reason || 'not_enabled',
      code: 'AI_MONITORING_NOT_ENABLED',
    }, 'warn');
    throw new RmoError(
      capabilities.reason || 'AI monitoring is not enabled for this division.',
      403,
      'AI_MONITORING_NOT_ENABLED',
    );
  }

  const existing = await prisma.aIProcessingJob.findFirst({
    where: { lobbyCallId: callId, status: { in: OPEN_STATUSES } },
    orderBy: { id: 'desc' },
  });
  if (existing) {
    if (existing.status === 'RUNNING' || existing.status === 'STARTING') {
      aiLog('AI_START_IDEMPOTENT', {
        jobId: existing.id,
        callId,
        divisionId: call.divisionId,
        status: existing.status,
      });
      return presentJob(existing);
    }
  }

  aiLog('AI_START_REQUESTED', {
    callId: call.id,
    divisionId: call.divisionId,
    lobbyId: call.lobbyId,
    actorId: actor.id,
    callStatus: call.status,
  });

  const job = await prisma.aIProcessingJob.create({
    data: {
      lobbyCallId: call.id,
      divisionId: call.divisionId,
      lobbyId: call.lobbyId,
      startedById: actor.id,
      status: 'STARTING',
    },
  });

  try {
    const response = await aiFetch('/sessions/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jobId: job.id,
        callId: call.id,
        divisionId: call.divisionId,
        lobbyId: call.lobbyId,
      }),
    });
    if (!response.ok) {
      await prisma.aIProcessingJob.update({
        where: { id: job.id },
        data: {
          status: 'ERROR',
          errorMessage: 'AI service rejected the start request.',
          stoppedAt: new Date(),
        },
      });
      aiLog('AI_START_FAILED', {
        jobId: job.id,
        callId: call.id,
        httpStatus: response.status,
        liveCallAffected: false,
      }, 'error');
      throw new RmoError(
        'AI service is unavailable. The live call was not affected.',
        503,
        'AI_SERVICE_UNAVAILABLE',
      );
    }
  } catch (error) {
    if (error instanceof RmoError) throw error;
    await prisma.aIProcessingJob.update({
      where: { id: job.id },
      data: {
        status: 'ERROR',
        errorMessage: 'AI service could not be reached.',
        stoppedAt: new Date(),
      },
    });
    aiLog('AI_START_FAILED', {
      jobId: job.id,
      callId: call.id,
      reason: 'unreachable',
      liveCallAffected: false,
    }, 'error');
    throw new RmoError(
      'AI service is unavailable. The live call was not affected.',
      503,
      'AI_SERVICE_UNAVAILABLE',
    );
  }

  const running = await prisma.aIProcessingJob.update({
    where: { id: job.id },
    data: { status: 'RUNNING' },
  });
  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: 'ai.processing.started',
      targetType: 'ai_processing_job',
      targetId: String(job.id),
      metadata: {
        callId: call.id,
        divisionId: call.divisionId,
        lobbyId: call.lobbyId,
      },
    },
  });
  aiLog('AI_SESSION_STARTED', {
    jobId: running.id,
    callId: call.id,
    divisionId: call.divisionId,
    lobbyId: call.lobbyId,
    actorId: actor.id,
    callStatus: call.status,
  });
  return presentJob(running);
}

export async function stopCallAIProcessing(actor: Actor, callId: number) {
  const role = asRole(actor.rmoRole);
  if (role !== 'DIVISION_MONITOR' && !canAdminister(role)) {
    throw new RmoError('Only a division monitor can stop AI processing.', 403);
  }
  const call = await loadCallForActor(actor, callId);
  if (role === 'DIVISION_MONITOR' && actor.homeDivisionId !== call.divisionId) {
    throw new RmoError('You cannot stop AI processing for another division.', 403);
  }

  const job = await prisma.aIProcessingJob.findFirst({
    where: { lobbyCallId: callId, status: { in: OPEN_STATUSES } },
    orderBy: { id: 'desc' },
  });
  if (!job) {
    const last = await prisma.aIProcessingJob.findFirst({
      where: { lobbyCallId: callId },
      orderBy: { id: 'desc' },
    });
    if (last) {
      aiLog('AI_STOP_IDEMPOTENT', {
        jobId: last.id,
        callId,
        status: last.status,
      });
      return presentJob(last);
    }
    throw new RmoError('No AI processing job is active for this call.', 404);
  }

  aiLog('AI_STOP_REQUESTED', {
    jobId: job.id,
    callId: call.id,
    divisionId: call.divisionId,
    actorId: actor.id,
  });

  await prisma.aIProcessingJob.update({
    where: { id: job.id },
    data: { status: 'STOPPING' },
  });

  try {
    await aiFetch(`/sessions/${job.id}/stop`, { method: 'POST' });
  } catch {
    aiLog('AI_STOP_SERVICE_UNREACHABLE', {
      jobId: job.id,
      callId: call.id,
      liveCallAffected: false,
    }, 'warn');
  }

  const stopped = await prisma.aIProcessingJob.update({
    where: { id: job.id },
    data: { status: 'STOPPED', stoppedAt: new Date() },
  });
  clearIdentitySession(callId);
  await closeSafetyEpisodes(job.id);
  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: 'ai.processing.stopped',
      targetType: 'ai_processing_job',
      targetId: String(job.id),
      metadata: {
        callId: call.id,
        divisionId: call.divisionId,
        lobbyId: call.lobbyId,
      },
    },
  });
  aiLog('AI_SESSION_STOPPED', {
    jobId: stopped.id,
    callId: call.id,
    divisionId: call.divisionId,
    framesProcessed: stopped.framesProcessed,
    callStatus: call.status,
    liveCallAffected: false,
  });
  return presentJob(stopped);
}

export async function ingestCallAIFrame(actor: Actor, callId: number, frame: ArrayBuffer) {
  const call = await loadCallForActor(actor, callId);
  const role = asRole(actor.rmoRole);
  if (role !== 'DIVISION_MONITOR' && role !== 'LOBBY_USER' && !canAdminister(role)) {
    throw new RmoError('You do not have permission to perform this action.', 403);
  }
  const capabilities = await getDivisionAICapabilities(call.divisionId);
  if (!capabilities.available) {
    aiLog('AI_FRAME_DENIED', {
      callId,
      divisionId: call.divisionId,
      code: 'AI_MONITORING_NOT_ENABLED',
    }, 'warn');
    throw new RmoError(
      'AI monitoring is not enabled for this division.',
      403,
      'AI_MONITORING_NOT_ENABLED',
    );
  }

  const job = await prisma.aIProcessingJob.findFirst({
    where: { lobbyCallId: callId, status: 'RUNNING' },
    orderBy: { id: 'desc' },
  });
  if (!job) {
    throw new RmoError('AI processing is not running for this call.', 409);
  }

  const forward = () => aiFetch(`/sessions/${job.id}/frames`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: frame,
  });
  let response: Response;
  try {
    response = await forward();
    if (response.status === 404) {
      // The AI service keeps sessions in memory; after a restart, reopen this job's session.
      const resumed = await aiFetch('/sessions/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          callId,
          divisionId: call.divisionId,
          lobbyId: call.lobbyId,
        }),
      });
      aiLog('AI_SESSION_RESUMED', {
        jobId: job.id,
        callId,
        httpStatus: resumed.status,
        liveCallAffected: false,
      }, resumed.ok ? 'info' : 'warn');
      if (resumed.ok) response = await forward();
    }
  } catch {
    aiLog('AI_FRAME_FORWARD_FAILED', {
      jobId: job.id,
      callId,
      bytes: frame.byteLength,
      liveCallAffected: false,
    }, 'warn');
    return presentJob(job);
  }
  if (!response.ok) {
    aiLog('AI_FRAME_FORWARD_REJECTED', {
      jobId: job.id,
      callId,
      httpStatus: response.status,
      bytes: frame.byteLength,
      liveCallAffected: false,
    }, 'warn');
    return presentJob(job);
  }
  const body = await response.json() as {
    framesReceived?: number;
    framesProcessed?: number;
    processingFps?: number;
    lastFrameAt?: string | null;
    persons?: TrackedPersonCandidate[];
    personCount?: number;
  };
  const updated = await prisma.aIProcessingJob.update({
    where: { id: job.id },
    data: {
      framesReceived: body.framesReceived ?? job.framesReceived,
      framesProcessed: body.framesProcessed ?? job.framesProcessed,
      processingFps: body.processingFps ?? job.processingFps,
      lastFrameAt: body.lastFrameAt ? new Date(body.lastFrameAt) : job.lastFrameAt,
    },
  });
  const processed = updated.framesProcessed;
  if (processed === 1 || processed % 5 === 0) {
    aiLog('AI_FRAME_INGESTED', {
      jobId: updated.id,
      callId,
      divisionId: call.divisionId,
      bytes: frame.byteLength,
      framesReceived: updated.framesReceived,
      framesProcessed: processed,
      processingFps: updated.processingFps,
    });
  }

  // Phase 11 — quality-gated identity (async; never blocks WebRTC / next frames).
  scheduleIdentityResolution({
    callId,
    divisionId: call.divisionId,
    actorId: actor.id,
    frame: Buffer.from(frame),
    persons: Array.isArray(body.persons) ? body.persons : [],
  });

  const merged = Array.isArray(body.persons)
    ? mergeIdentityIntoPersons(callId, body.persons as unknown as Array<Record<string, unknown>>)
    : [];
  if (capabilities.features.impairmentDetection && Array.isArray(body.persons)) {
    void recordSafetyEpisodes({
      jobId: job.id,
      callId,
      divisionId: call.divisionId,
      lobbyId: call.lobbyId,
      persons: merged as SafetyPersonCandidate[],
    });
  }

  return {
    ...presentJob(updated),
    overlay: role === 'LOBBY_USER'
      ? []
      : buildLiveOverlay(
          merged as Array<Record<string, unknown>>,
          capabilities.features.impairmentDetection,
        ),
  };
}
