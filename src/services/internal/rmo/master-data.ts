import { prisma } from '@/lib/prisma';
import { MasterStatus, Prisma } from '@/lib/prisma/generated/client';
import { RmoError } from '@/lib/rmo/errors';
import type { Actor } from '@/services/internal/rmo/administration';
import { recordAudit } from '@/services/internal/rmo/audit-event';
import { actorRole } from '@/services/internal/rmo/submission-scope';

const DENIED = 'You do not have permission to perform this action.';

export type MasterKind = 'crewType' | 'dutyType' | 'registerType';

export interface MasterWriteInput {
  code?: string;
  name?: string;
  description?: string;
  status?: string;
}

function assertSystemAdmin(actor: Actor) {
  if (actorRole(actor) !== 'SYSTEM_ADMIN') throw new RmoError(DENIED, 403);
}

function assertMasterReader(actor: Actor) {
  const role = actorRole(actor);
  if (
    role === 'SYSTEM_ADMIN' ||
    role === 'DIVISION_ADMIN' ||
    role === 'DIVISION_MONITOR' ||
    role === 'LOBBY_USER' ||
    role === 'CREW_USER'
  ) {
    return role;
  }
  throw new RmoError(DENIED, 403);
}

function normalizeCode(code: string | undefined) {
  const value = code?.trim().toUpperCase().replace(/\s+/g, '_');
  if (!value) throw new RmoError('Code is required.', 400);
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(value)) {
    throw new RmoError('Code must be uppercase letters, numbers, or underscores.', 400);
  }
  return value;
}

function normalizeStatus(status: string | undefined): MasterStatus | undefined {
  if (status == null) return undefined;
  if (status !== 'ACTIVE' && status !== 'INACTIVE') {
    throw new RmoError('Status must be ACTIVE or INACTIVE.', 400);
  }
  return status;
}

const select = {
  id: true,
  code: true,
  name: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

type MasterClient = {
  findMany: (args: unknown) => Promise<unknown[]>;
  count: (args: unknown) => Promise<number>;
  findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
  update: (args: unknown) => Promise<Record<string, unknown>>;
};

function clientFor(kind: MasterKind): MasterClient {
  if (kind === 'crewType') return prisma.crewType as unknown as MasterClient;
  if (kind === 'dutyType') return prisma.dutyType as unknown as MasterClient;
  return prisma.registerType as unknown as MasterClient;
}

function auditTarget(kind: MasterKind) {
  if (kind === 'crewType') return 'crew_type';
  if (kind === 'dutyType') return 'duty_type';
  return 'register_type';
}

export async function listMasters(
  actor: Actor,
  kind: MasterKind,
  query: { search?: string; status?: string; page?: number; pageSize?: number },
) {
  assertMasterReader(actor);
  const page = Math.max(query.page || 1, 1);
  const pageSize = Math.min(Math.max(query.pageSize || 50, 1), 100);
  const status = normalizeStatus(query.status);
  const where: Prisma.CrewTypeWhereInput = {
    ...(status ? { status } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const client = clientFor(kind);
  const [items, total] = await Promise.all([
    client.findMany({
      where,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select,
    }),
    client.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getMaster(actor: Actor, kind: MasterKind, id: number) {
  assertMasterReader(actor);
  if (!Number.isInteger(id)) throw new RmoError('Not found.', 404);
  const row = await clientFor(kind).findUnique({ where: { id }, select });
  if (!row) throw new RmoError('Not found.', 404);
  return row;
}

export async function createMaster(actor: Actor, kind: MasterKind, input: MasterWriteInput) {
  assertSystemAdmin(actor);
  const code = normalizeCode(input.code);
  const name = input.name?.trim();
  if (!name) throw new RmoError('Name is required.', 400);
  const status = normalizeStatus(input.status) ?? 'ACTIVE';
  try {
    const row = await clientFor(kind).create({
      data: {
        code,
        name,
        description: input.description?.trim() ?? '',
        status,
        createdById: actor.id,
      },
      select,
    });
    await recordAudit(actor.id, `${auditTarget(kind)}.created`, auditTarget(kind), row.id as number, {
      code,
      name,
      status,
    });
    return row;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new RmoError('A record with this code already exists.', 409);
    }
    throw error;
  }
}

export async function updateMaster(
  actor: Actor,
  kind: MasterKind,
  id: number,
  input: MasterWriteInput,
) {
  assertSystemAdmin(actor);
  if (!Number.isInteger(id)) throw new RmoError('Not found.', 404);
  const existing = await clientFor(kind).findUnique({ where: { id }, select });
  if (!existing) throw new RmoError('Not found.', 404);
  const data: Record<string, unknown> = {};
  if (input.code !== undefined) data.code = normalizeCode(input.code);
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new RmoError('Name is required.', 400);
    data.name = name;
  }
  if (input.description !== undefined) data.description = input.description.trim();
  if (input.status !== undefined) data.status = normalizeStatus(input.status);
  if (!Object.keys(data).length) return existing;
  try {
    const row = await clientFor(kind).update({ where: { id }, data, select });
    await recordAudit(actor.id, `${auditTarget(kind)}.updated`, auditTarget(kind), id, {
      before: existing as Prisma.InputJsonValue,
      after: row as Prisma.InputJsonValue,
    });
    return row;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new RmoError('A record with this code already exists.', 409);
    }
    throw error;
  }
}

export async function listActiveMasters(kind: MasterKind) {
  return clientFor(kind).findMany({
    where: { status: 'ACTIVE' },
    orderBy: { name: 'asc' },
    select,
  });
}
