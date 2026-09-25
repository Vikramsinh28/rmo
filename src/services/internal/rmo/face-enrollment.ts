import { prisma } from '@/lib/prisma';
import { aiLog } from '@/lib/rmo/ai-log';
import { RmoError } from '@/lib/rmo/errors';
import { assertDivisionAIFeature } from '@/services/internal/rmo/ai-entitlement';
import { Actor } from '@/services/internal/rmo/administration';
import { recordAudit } from '@/services/internal/rmo/audit-event';
import {
  divisionCollectionId,
  externalImageIdForUser,
  getFaceIndexProvider,
} from '@/services/external/aws/rekognition';
import { FaceEnrollmentStatus } from '@/lib/prisma/generated/client';

const MAX_SAMPLE_BYTES = 1_500_000;
const MAX_SAMPLES = 5;
const MIN_SAMPLES = 3;
const JPEG_SOI = Buffer.from([0xff, 0xd8]);

const activeLocks = new Set<number>();

function assertCrewActor(actor: Actor) {
  if (actor.rmoRole !== 'CREW_USER') {
    throw new RmoError('Only a crew member can enroll their own face.', 403);
  }
  if (actor.accountStatus === 'DISABLED') {
    throw new RmoError('This account is disabled.', 403);
  }
  if (!actor.homeDivisionId) {
    throw new RmoError('No home division is assigned to this account.', 403);
  }
  return actor.homeDivisionId;
}

function presentEnrollment(row: {
  status: FaceEnrollmentStatus;
  enrolledAt: Date | null;
  provider: string;
  failureReason: string | null;
  updatedAt: Date;
} | null) {
  if (!row) {
    return {
      status: 'NOT_ENROLLED' as const,
      provider: 'AWS_REKOGNITION' as const,
      enrolledAt: null,
      failureReason: null,
      canEnroll: true,
      canReenroll: false,
    };
  }
  return {
    status: row.status,
    provider: row.provider,
    enrolledAt: row.enrolledAt?.toISOString() || null,
    failureReason: row.status === 'FAILED' ? row.failureReason : null,
    canEnroll: row.status !== 'ENROLLED' && row.status !== 'PENDING',
    canReenroll: row.status === 'ENROLLED',
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validateSample(bytes: Buffer, index: number) {
  if (!bytes.length) {
    throw new RmoError(`Sample ${index + 1} is empty.`, 400, 'EMPTY_IMAGE');
  }
  if (bytes.byteLength > MAX_SAMPLE_BYTES) {
    throw new RmoError(`Sample ${index + 1} is too large.`, 413, 'IMAGE_TOO_LARGE');
  }
  if (!(bytes[0] === JPEG_SOI[0] && bytes[1] === JPEG_SOI[1])) {
    throw new RmoError(`Sample ${index + 1} must be a JPEG image.`, 400, 'INVALID_IMAGE');
  }
  if (bytes.byteLength < 2_000) {
    throw new RmoError(
      'We could not get a clear face image. Please improve lighting and try again.',
      400,
      'IMAGE_TOO_SMALL',
    );
  }
}

async function ensureDivisionCollection(divisionId: number) {
  const collectionId = divisionCollectionId(divisionId);
  const existing = await prisma.divisionFaceCollection.findUnique({ where: { divisionId } });
  if (existing) return existing.collectionId;

  const provider = getFaceIndexProvider();
  await provider.ensureCollection(collectionId);
  const saved = await prisma.divisionFaceCollection.upsert({
    where: { divisionId },
    create: { divisionId, collectionId },
    update: { collectionId },
  });
  return saved.collectionId;
}

function mapProviderFailure(error: unknown): { message: string; code: string } {
  if (error instanceof Error) {
    if (error.name === 'AwsNotConfigured') {
      return {
        message: 'Face enrollment is not available because AWS is not configured.',
        code: 'AWS_NOT_CONFIGURED',
      };
    }
    if (error.name === 'FaceIndexRejected' || /NO_FACE|LOW_QUALITY|TOO_SMALL/i.test(error.message)) {
      return {
        message: 'We could not get a clear face image. Please improve lighting and try again.',
        code: 'NO_FACE',
      };
    }
  }
  return {
    message: 'Face enrollment could not be completed. Please try again.',
    code: 'ENROLLMENT_FAILED',
  };
}

export async function getMyFaceEnrollment(actor: Actor) {
  const divisionId = assertCrewActor(actor);
  try {
    await assertDivisionAIFeature(divisionId, 'faceIdentification');
  } catch (error) {
    if (error instanceof RmoError) {
      const row = await prisma.userFaceEnrollment.findFirst({
        where: { userId: actor.id },
        orderBy: { id: 'desc' },
      });
      return {
        ...presentEnrollment(row),
        entitlement: {
          available: false,
          reason: error.message,
          code: 'FACE_IDENTIFICATION_NOT_ENABLED',
        },
      };
    }
    throw error;
  }

  const row = await prisma.userFaceEnrollment.findFirst({
    where: { userId: actor.id },
    orderBy: { id: 'desc' },
  });
  return {
    ...presentEnrollment(row),
    entitlement: { available: true, reason: null, code: null },
  };
}

export async function enrollMyFace(
  actor: Actor,
  samples: Buffer[],
  options: { confirmReenroll?: boolean } = {},
) {
  const divisionId = assertCrewActor(actor);

  if (activeLocks.has(actor.id)) {
    throw new RmoError('An enrollment is already in progress.', 409, 'ENROLLMENT_IN_PROGRESS');
  }
  activeLocks.add(actor.id);

  try {
    try {
      await assertDivisionAIFeature(divisionId, 'faceIdentification');
    } catch (error) {
      if (error instanceof RmoError) {
        aiLog('FACE_ENROLL_DENIED', {
          userId: actor.id,
          divisionId,
          code: 'FACE_IDENTIFICATION_NOT_ENABLED',
        }, 'warn');
        throw new RmoError(
          'Face identification is not enabled for your division.',
          403,
          'FACE_IDENTIFICATION_NOT_ENABLED',
        );
      }
      throw error;
    }

    if (samples.length < MIN_SAMPLES || samples.length > MAX_SAMPLES) {
      throw new RmoError(`Capture between ${MIN_SAMPLES} and ${MAX_SAMPLES} face samples.`, 400);
    }
    samples.forEach((sample, index) => validateSample(sample, index));

    const current = await prisma.userFaceEnrollment.findFirst({
      where: { userId: actor.id },
      orderBy: { id: 'desc' },
    });
    if (current?.status === 'PENDING') {
      throw new RmoError('An enrollment is already in progress.', 409, 'ENROLLMENT_IN_PROGRESS');
    }
    if (current?.status === 'ENROLLED' && !options.confirmReenroll) {
      throw new RmoError(
        'Your face is already enrolled. Confirm re-enrollment to continue.',
        409,
        'REENROLL_CONFIRMATION_REQUIRED',
      );
    }

    await recordAudit(actor.id, 'crew.face_enrollment.started', 'user_face_enrollment', actor.id, {
      userId: actor.id,
      divisionId,
      provider: 'AWS_REKOGNITION',
      reenroll: Boolean(options.confirmReenroll && current?.status === 'ENROLLED'),
      sampleCount: samples.length,
    });
    aiLog('FACE_ENROLL_STARTED', {
      userId: actor.id,
      divisionId,
      sampleCount: samples.length,
      reenroll: Boolean(options.confirmReenroll),
    });

    const pending = current
      ? await prisma.userFaceEnrollment.update({
          where: { id: current.id },
          data: {
            status: 'PENDING',
            failureReason: null,
            divisionId,
          },
        })
      : await prisma.userFaceEnrollment.create({
          data: {
            userId: actor.id,
            divisionId,
            status: 'PENDING',
            provider: 'AWS_REKOGNITION',
          },
        });

    let collectionId: string;
    try {
      collectionId = await ensureDivisionCollection(divisionId);
    } catch (error) {
      const mapped = mapProviderFailure(error);
      await prisma.userFaceEnrollment.update({
        where: { id: pending.id },
        data: { status: 'FAILED', failureReason: mapped.code },
      });
      await recordAudit(actor.id, 'crew.face_enrollment.failed', 'user_face_enrollment', pending.id, {
        userId: actor.id,
        divisionId,
        provider: 'AWS_REKOGNITION',
        reason: mapped.code,
      });
      throw new RmoError(mapped.message, mapped.code === 'AWS_NOT_CONFIGURED' ? 503 : 502, mapped.code);
    }

    const provider = getFaceIndexProvider();
    if (current?.status === 'ENROLLED' && current.providerFaceId && current.collectionId) {
      try {
        await provider.deleteFaces(current.collectionId, [current.providerFaceId]);
      } catch {
        aiLog('FACE_REENROLL_DELETE_WARN', {
          userId: actor.id,
          divisionId,
        }, 'warn');
      }
    }

    let indexed: { faceId: string } | null = null;
    let lastError: unknown;
    for (const sample of samples) {
      try {
        indexed = await provider.indexFace({
          collectionId,
          externalImageId: externalImageIdForUser(actor.id),
          imageBytes: sample,
        });
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!indexed) {
      const mapped = mapProviderFailure(lastError);
      await prisma.userFaceEnrollment.update({
        where: { id: pending.id },
        data: { status: 'FAILED', failureReason: mapped.code },
      });
      await recordAudit(actor.id, 'crew.face_enrollment.failed', 'user_face_enrollment', pending.id, {
        userId: actor.id,
        divisionId,
        provider: 'AWS_REKOGNITION',
        reason: mapped.code,
      });
      aiLog('FACE_ENROLL_FAILED', {
        userId: actor.id,
        divisionId,
        reason: mapped.code,
      }, 'warn');
      throw new RmoError(mapped.message, 422, mapped.code);
    }

    const enrolled = await prisma.userFaceEnrollment.update({
      where: { id: pending.id },
      data: {
        status: 'ENROLLED',
        collectionId,
        providerFaceId: indexed.faceId,
        enrolledAt: new Date(),
        lastVerifiedAt: new Date(),
        failureReason: null,
      },
    });

    const action = current?.status === 'ENROLLED'
      ? 'crew.face_enrollment.reenrolled'
      : 'crew.face_enrollment.completed';
    await recordAudit(actor.id, action, 'user_face_enrollment', enrolled.id, {
      userId: actor.id,
      divisionId,
      provider: 'AWS_REKOGNITION',
    });
    aiLog('FACE_ENROLL_COMPLETED', {
      userId: actor.id,
      divisionId,
      enrollmentId: enrolled.id,
      reenroll: action.includes('reenroll'),
    });

    return presentEnrollment(enrolled);
  } finally {
    activeLocks.delete(actor.id);
  }
}

export async function faceEnrollmentStatusByUserIds(userIds: number[]) {
  if (userIds.length === 0) return new Map<number, FaceEnrollmentStatus>();
  const rows = await prisma.userFaceEnrollment.findMany({
    where: { userId: { in: userIds } },
    orderBy: { id: 'desc' },
  });
  const map = new Map<number, FaceEnrollmentStatus>();
  for (const row of rows) {
    if (!map.has(row.userId)) map.set(row.userId, row.status);
  }
  return map;
}

export async function divisionFaceEnrollmentSummary(divisionId: number) {
  const [crewTotal, enrolled] = await Promise.all([
    prisma.user.count({
      where: {
        deletedAt: null,
        rmoRole: 'CREW_USER',
        homeDivisionId: divisionId,
        accountStatus: 'ACTIVE',
      },
    }),
    prisma.userFaceEnrollment.count({
      where: {
        divisionId,
        status: 'ENROLLED',
        user: {
          deletedAt: null,
          rmoRole: 'CREW_USER',
          accountStatus: 'ACTIVE',
        },
      },
    }),
  ]);
  return { crewTotal, enrolled };
}
