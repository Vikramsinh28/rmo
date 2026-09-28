import { RmoError } from '@/lib/rmo/errors';
import { canAdminister, isRmoRole, type RmoRoleName } from '@/lib/rmo/access';
import { aiLog } from '@/lib/rmo/ai-log';
import { Actor } from '@/services/internal/rmo/administration';

const MAX_FRAME_BYTES = 2_000_000;
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function asRole(role: Actor['rmoRole']): RmoRoleName {
  if (!isRmoRole(role)) throw new RmoError('You do not have permission to perform this action.', 403);
  return role;
}

function aiBaseUrl() {
  return (process.env.AI_SERVICE_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');
}

function aiToken() {
  return process.env.AI_SERVICE_TOKEN || 'local-ai-service-token';
}

function assertPocEnabled() {
  if (process.env.IMPAIRMENT_POC_ENABLED !== 'true') {
    throw new RmoError(
      'Impairment detection POC is disabled. Set IMPAIRMENT_POC_ENABLED=true for local development only.',
      403,
      'IMPAIRMENT_POC_DISABLED',
    );
  }
  if (process.env.NODE_ENV === 'production') {
    throw new RmoError(
      'Impairment detection POC is not available in production.',
      403,
      'IMPAIRMENT_POC_DISABLED',
    );
  }
}

function validateFrame(bytes: Buffer) {
  if (!bytes.length) throw new RmoError('Frame image is empty.', 400, 'EMPTY_IMAGE');
  if (bytes.byteLength > MAX_FRAME_BYTES) {
    throw new RmoError('Frame image is too large.', 413, 'IMAGE_TOO_LARGE');
  }
  const isJpeg = bytes[0] === JPEG_SOI[0] && bytes[1] === JPEG_SOI[1];
  const isPng = PNG_SIG.equals(bytes.subarray(0, 8));
  if (!isJpeg && !isPng) {
    throw new RmoError('Frame must be a JPEG or PNG image.', 400, 'INVALID_IMAGE');
  }
}

/**
 * Phase 9A — INTERNAL / DEVELOPMENT ONLY proxy to the AI service impairment POC.
 * Not wired to live WebRTC sessions. Does not persist images or results.
 */
export async function analyzeImpairmentPoc(actor: Actor, frame: Buffer) {
  assertPocEnabled();
  const role = asRole(actor.rmoRole);
  if (!canAdminister(role)) {
    throw new RmoError(
      'Only a system admin can use the impairment detection POC endpoint.',
      403,
    );
  }

  validateFrame(frame);

  aiLog('IMPAIRMENT_POC_REQUESTED', {
    actorId: actor.id,
    bytes: frame.byteLength,
    developmentOnly: true,
  });

  const form = new FormData();
  form.append(
    'frame',
    new Blob([new Uint8Array(frame)], {
      type: frame[0] === 0xff ? 'image/jpeg' : 'image/png',
    }),
    'frame.jpg',
  );

  let response: Response;
  try {
    response = await fetch(`${aiBaseUrl()}/impairment/analyze`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aiToken()}` },
      body: form,
    });
  } catch (error) {
    aiLog('IMPAIRMENT_POC_AI_UNAVAILABLE', {
      actorId: actor.id,
      reason: error instanceof Error ? error.name : 'unknown',
    }, 'error');
    throw new RmoError(
      'Impairment POC AI service is unavailable.',
      503,
      'IMPAIRMENT_SERVICE_UNAVAILABLE',
    );
  }

  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !body) {
    aiLog('IMPAIRMENT_POC_FAILED', {
      actorId: actor.id,
      status: response.status,
    }, 'warn');
    throw new RmoError(
      'Impairment analysis could not be completed.',
      response.status >= 400 && response.status < 600 ? response.status : 503,
      typeof body?.detail === 'string' ? body.detail : 'IMPAIRMENT_ANALYZE_FAILED',
    );
  }

  const serialized = JSON.stringify(body);
  if (/secretAccessKey|AWS_ACCESS_KEY|providerFaceId/i.test(serialized)) {
    throw new RmoError('Unsafe impairment response blocked.', 502, 'UNSAFE_RESPONSE');
  }

  aiLog('IMPAIRMENT_POC_COMPLETED', {
    actorId: actor.id,
    provider: typeof body.provider === 'string' ? body.provider : 'unknown',
    status: typeof (body.analysis as { status?: unknown } | undefined)?.status === 'string'
      ? (body.analysis as { status: string }).status
      : undefined,
  });

  return {
    ...body,
    developmentOnly: true,
    internalPoc: true,
  };
}
