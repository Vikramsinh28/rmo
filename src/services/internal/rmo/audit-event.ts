import { prisma } from '@/lib/prisma';
import { Prisma } from '@/lib/prisma/generated/client';

export async function recordAudit(
  actorId: number,
  action: string,
  targetType: string,
  targetId: string | number | null,
  metadata?: Prisma.InputJsonValue,
) {
  await prisma.auditLog.create({
    data: {
      actorId,
      action,
      targetType,
      targetId: targetId == null ? null : String(targetId),
      metadata,
    },
  });
}
