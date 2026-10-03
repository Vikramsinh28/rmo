import { prisma } from '@/lib/prisma';
import { RmoError } from '@/lib/rmo/errors';
import type { Actor } from '@/services/internal/rmo/administration';
import { recordAudit } from '@/services/internal/rmo/audit-event';
import { actorRole } from '@/services/internal/rmo/submission-scope';

const DENIED = 'You do not have permission to perform this action.';
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;

function assertTypeAdmin(actor: Actor) {
  const role = actorRole(actor);
  if (role !== 'SYSTEM_ADMIN' && role !== 'SUPER_ADMIN') {
    throw new RmoError(DENIED, 403);
  }
}

function normalizeCode(value: unknown): string {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!CODE_PATTERN.test(code)) {
    throw new RmoError(
      'Code must start with a letter and use uppercase letters, numbers, or underscores.',
      400,
    );
  }
  return code;
}

function normalizeName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new RmoError('Name is required.', 400);
  if (name.length > 80) throw new RmoError('Name must be 80 characters or fewer.', 400);
  return name;
}

export async function listDutyTypes(options?: { activeOnly?: boolean }) {
  return prisma.dutyType.findMany({
    where: options?.activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function createDutyType(
  actor: Actor,
  input: { code?: string; name?: string; sortOrder?: number },
) {
  assertTypeAdmin(actor);
  const code = normalizeCode(input.code);
  const name = normalizeName(input.name);
  const sortOrder =
    input.sortOrder == null
      ? 0
      : Number.isInteger(input.sortOrder)
        ? (input.sortOrder as number)
        : NaN;
  if (!Number.isInteger(sortOrder)) throw new RmoError('Sort order is invalid.', 400);
  try {
    const created = await prisma.dutyType.create({
      data: { code, name, sortOrder, isActive: true },
    });
    await recordAudit(actor.id, 'duty_type.created', 'duty_type', created.id, { code, name });
    return created;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code: string }).code === 'P2002'
    ) {
      throw new RmoError('A duty type with this code already exists.', 400);
    }
    throw error;
  }
}

export async function updateDutyType(
  actor: Actor,
  id: number,
  input: { name?: string; isActive?: boolean; sortOrder?: number },
) {
  assertTypeAdmin(actor);
  if (!Number.isInteger(id)) throw new RmoError('Duty type not found.', 404);
  const existing = await prisma.dutyType.findUnique({ where: { id } });
  if (!existing) throw new RmoError('Duty type not found.', 404);
  const data: { name?: string; isActive?: boolean; sortOrder?: number } = {};
  if (input.name !== undefined) data.name = normalizeName(input.name);
  if (input.isActive !== undefined) {
    if (typeof input.isActive !== 'boolean') throw new RmoError('isActive must be a boolean.', 400);
    data.isActive = input.isActive;
  }
  if (input.sortOrder !== undefined) {
    if (!Number.isInteger(input.sortOrder)) throw new RmoError('Sort order is invalid.', 400);
    data.sortOrder = input.sortOrder;
  }
  const updated = await prisma.dutyType.update({ where: { id }, data });
  await recordAudit(actor.id, 'duty_type.updated', 'duty_type', id, data);
  return updated;
}

export async function ensureDefaultDutyTypes() {
  const defaults = [
    { code: 'SIGN_ON', name: 'Sign On', sortOrder: 1 },
    { code: 'SIGN_OFF', name: 'Sign Off', sortOrder: 2 },
  ];
  for (const row of defaults) {
    await prisma.dutyType.upsert({
      where: { code: row.code },
      create: { ...row, isActive: true },
      update: { name: row.name, sortOrder: row.sortOrder },
    });
  }
}
