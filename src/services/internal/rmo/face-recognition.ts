import { prisma } from '@/lib/prisma';
import { canAdminister, isRmoRole, type RmoRoleName } from '@/lib/rmo/access';
import { aiLog } from '@/lib/rmo/ai-log';
import { RmoError } from '@/lib/rmo/errors';
import { assertDivisionAIFeature } from '@/services/internal/rmo/ai-entitlement';
import { Actor } from '@/services/internal/rmo/administration';
import { recordAudit } from '@/services/internal/rmo/audit-event';
import {
  cropFaceJpeg,
  getFaceSearchProvider,
  recognitionCooldownMs,
  recognitionMatchThreshold,
} from '@/services/external/aws/rekognition';

const MAX_FRAME_BYTES = 2_000_000;
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const lastRecognitionAt = new Map<number, number>();
const recognitionRequestCounts = new Map<number, number>();

export interface RecognitionFaceResult {
  match: boolean;
  userId: number | null;
  displayName: string | null;
  confidence: number | null;
  status: 'identified' | 'unknown' | 'low_confidence';
}

function asRole(role: Actor['rmoRole']): RmoRoleName {
  if (!isRmoRole(role)) throw new RmoError('You do not have permission to perform this action.', 403);
  return role;
}

function validateFrame(bytes: Buffer) {
  if (!bytes.length) throw new RmoError('Frame image is empty.', 400, 'EMPTY_IMAGE');
  if (bytes.byteLength > MAX_FRAME_BYTES) {
    throw new RmoError('Frame image is too large.', 413, 'IMAGE_TOO_LARGE');
  }
  if (!(bytes[0] === JPEG_SOI[0] && bytes[1] === JPEG_SOI[1])) {
    throw new RmoError('Frame must be a JPEG image.', 400, 'INVALID_IMAGE');
  }
}

async function resolveMatch(
  faceId: string,
  confidence: number,
  divisionId: number,
  threshold: number,
): Promise<RecognitionFaceResult> {
  if (confidence < threshold) {
    return {
      match: false,
      userId: null,
      displayName: null,
      confidence,
      status: 'low_confidence',
    };
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
    return {
      match: false,
      userId: null,
      displayName: null,
      confidence,
      status: 'unknown',
    };
  }

  return {
    match: true,
    userId: user.id,
    displayName: user.name,
    confidence,
    status: 'identified',
  };
}

export async function recognizeFacesInCall(actor: Actor, callId: number, frame: Buffer) {
  const role = asRole(actor.rmoRole);
  if (role !== 'DIVISION_MONITOR' && !canAdminister(role)) {
    throw new RmoError('Only a division monitor can recognize faces.', 403);
  }

  const call = await prisma.lobbyCall.findUnique({
    where: { id: callId },
    select: {
      id: true,
      status: true,
      divisionId: true,
      lobbyId: true,
      monitorUserId: true,
    },
  });
  if (!call) throw new RmoError('Call not found.', 404);
  if (call.status !== 'CONNECTED') {
    throw new RmoError('Face recognition requires an active connected call.', 409, 'CALL_NOT_CONNECTED');
  }
  if (role === 'DIVISION_MONITOR') {
    if (actor.homeDivisionId !== call.divisionId) {
      throw new RmoError('You cannot recognize faces for another division.', 403);
    }
    if (actor.id !== call.monitorUserId && actor.homeDivisionId !== call.divisionId) {
      throw new RmoError('You do not have permission to perform this action.', 403);
    }
  }

  try {
    await assertDivisionAIFeature(call.divisionId, 'faceIdentification');
  } catch (error) {
    if (error instanceof RmoError) {
      throw new RmoError(
        'Face identification is not enabled for this division.',
        403,
        'FACE_IDENTIFICATION_NOT_ENABLED',
      );
    }
    throw error;
  }

  const cooldownMs = recognitionCooldownMs();
  const previous = lastRecognitionAt.get(callId) || 0;
  const elapsed = Date.now() - previous;
  if (previous && elapsed < cooldownMs) {
    throw new RmoError(
      `Please wait ${Math.ceil((cooldownMs - elapsed) / 1000)} seconds before recognizing again.`,
      429,
      'RECOGNITION_RATE_LIMITED',
    );
  }

  validateFrame(frame);

  const collection = await prisma.divisionFaceCollection.findUnique({
    where: { divisionId: call.divisionId },
  });
  if (!collection) {
    throw new RmoError(
      'No face collection exists for this division. Enroll crew faces first.',
      409,
      'COLLECTION_MISSING',
    );
  }

  await recordAudit(actor.id, 'face.recognition.requested', 'lobby_call', call.id, {
    callId: call.id,
    divisionId: call.divisionId,
    monitorUserId: actor.id,
  });
  aiLog('FACE_RECOGNITION_REQUESTED', {
    callId: call.id,
    divisionId: call.divisionId,
    actorId: actor.id,
    bytes: frame.byteLength,
  });

  lastRecognitionAt.set(callId, Date.now());
  recognitionRequestCounts.set(callId, (recognitionRequestCounts.get(callId) || 0) + 1);

  const threshold = recognitionMatchThreshold();
  let faces: RecognitionFaceResult[] = [];

  try {
    const provider = getFaceSearchProvider();
    const boxes = await provider.detectFaces(frame);
    const targets = boxes.length > 0
      ? boxes
      : [{ left: 0, top: 0, width: 1, height: 1 }];
    const mockMode = (
      process.env.FACE_RECOGNITION_PROVIDER === 'mock'
      || process.env.FACE_ENROLLMENT_PROVIDER === 'mock'
    );
    for (const box of targets) {
      let searchBytes: Buffer = frame;
      if (!mockMode && boxes.length > 0) {
        try {
          searchBytes = await cropFaceJpeg(frame, box);
        } catch {
          faces.push({
            match: false,
            userId: null,
            displayName: null,
            confidence: null,
            status: 'unknown',
          });
          continue;
        }
      }
      const match = await provider.searchFace({
        collectionId: collection.collectionId,
        imageBytes: searchBytes,
        threshold: 1,
      });
      if (!match) {
        faces.push({
          match: false,
          userId: null,
          displayName: null,
          confidence: null,
          status: 'unknown',
        });
        continue;
      }
      faces.push(await resolveMatch(match.faceId, match.confidence, call.divisionId, threshold));
    }
  } catch (error) {
    await recordAudit(actor.id, 'face.recognition.failed', 'lobby_call', call.id, {
      callId: call.id,
      divisionId: call.divisionId,
      monitorUserId: actor.id,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    aiLog('FACE_RECOGNITION_FAILED', {
      callId: call.id,
      divisionId: call.divisionId,
      liveCallAffected: false,
      reason: error instanceof Error ? error.name : 'unknown',
    }, 'error');
    if (error instanceof Error && error.name === 'AwsNotConfigured') {
      throw new RmoError(
        'Face recognition is unavailable because AWS is not configured.',
        503,
        'AWS_NOT_CONFIGURED',
      );
    }
    throw new RmoError(
      'Face recognition could not be completed. The live call was not affected.',
      503,
      'RECOGNITION_UNAVAILABLE',
    );
  }

  const matchedUserIds = faces
    .filter(face => face.match && face.userId != null)
    .map(face => face.userId as number);

  await recordAudit(actor.id, 'face.recognition.completed', 'lobby_call', call.id, {
    callId: call.id,
    divisionId: call.divisionId,
    monitorUserId: actor.id,
    matchCount: matchedUserIds.length,
    matchedUserIds,
  });
  aiLog('FACE_RECOGNITION_COMPLETED', {
    callId: call.id,
    divisionId: call.divisionId,
    faceCount: faces.length,
    matchCount: matchedUserIds.length,
    recognitionRequestCount: recognitionRequestCounts.get(callId) || 1,
    liveCallAffected: false,
  });

  return {
    success: true,
    recognizedAt: new Date().toISOString(),
    callId: call.id,
    callStatus: call.status,
    recognitionRequestCount: recognitionRequestCounts.get(callId) || 1,
    cooldownMs,
    faces,
  };
}
