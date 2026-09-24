import { prisma } from '@/lib/prisma';
import { Prisma, SubmissionStatus } from '@/lib/prisma/generated/client';
import { isRmoRole, type RmoRoleName } from '@/lib/rmo/access';
import { RmoError } from '@/lib/rmo/errors';
import type { Actor } from '@/services/internal/rmo/administration';

export interface SubmissionFilter {
  search?: string;
  status?: string;
  divisionId?: number;
  lobbyId?: number;
  formId?: number;
  registerId?: number;
  userId?: number;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

const DENIED = 'You do not have permission to perform this action.';

export function actorRole(actor: Actor): RmoRoleName {
  if (!isRmoRole(actor.rmoRole)) throw new RmoError('Unknown role.', 400);
  return actor.rmoRole;
}

export function assertFormManager(actor: Actor): RmoRoleName {
  const role = actorRole(actor);
  if (role === 'SYSTEM_ADMIN') return role;
  if (role === 'DIVISION_ADMIN' && actor.homeDivisionId) return role;
  throw new RmoError(DENIED, 403);
}

export function assertRecordReader(actor: Actor): RmoRoleName {
  const role = actorRole(actor);
  if (role === 'SYSTEM_ADMIN') return role;
  if ((role === 'DIVISION_ADMIN' || role === 'DIVISION_MONITOR') && actor.homeDivisionId) {
    return role;
  }
  throw new RmoError(DENIED, 403);
}

export function assertAnalyticsReader(actor: Actor): RmoRoleName {
  const role = actorRole(actor);
  if (role === 'SYSTEM_ADMIN') return role;
  if (role === 'DIVISION_ADMIN' && actor.homeDivisionId) return role;
  throw new RmoError(DENIED, 403);
}

export function assertSubmitter(actor: Actor): RmoRoleName {
  const role = actorRole(actor);
  if ((role === 'LOBBY_USER' || role === 'CREW_USER') && actor.homeDivisionId && actor.homeLobbyId) {
    return role;
  }
  throw new RmoError(DENIED, 403);
}

export function rejectForeignDivision(actor: Actor, requested?: number) {
  if (requested != null && !Number.isInteger(requested)) {
    throw new RmoError('Division is invalid.', 400);
  }
  const role = actorRole(actor);
  if (role === 'SYSTEM_ADMIN') return;
  if (requested != null && requested !== actor.homeDivisionId) {
    throw new RmoError(DENIED, 403);
  }
}

function integerId(value: number | undefined, label: string): number | undefined {
  if (value == null) return undefined;
  if (!Number.isInteger(value)) throw new RmoError(`${label} is invalid.`, 400);
  return value;
}

function dayStart(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RmoError('Date is invalid.', 400);
  return new Date(`${value}T00:00:00.000Z`);
}

function dayEnd(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RmoError('Date is invalid.', 400);
  return new Date(`${value}T23:59:59.999Z`);
}

export function defaultRange(days: number): { from: Date; to: Date } {
  const to = new Date();
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23, 59, 59, 999));
  const from = new Date(end);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  from.setUTCHours(0, 0, 0, 0);
  return { from, to };
}

export async function buildSubmissionWhere(
  actor: Actor,
  filter: SubmissionFilter,
  options?: { defaultDays?: number },
): Promise<{
  where: Prisma.SubmissionWhereInput;
  from: Date | null;
  to: Date | null;
  sql: Prisma.Sql;
}> {
  const role = actorRole(actor);
  const divisionId = integerId(filter.divisionId, 'Division');
  const lobbyId = integerId(filter.lobbyId, 'Lobby');
  const formId = integerId(filter.formId, 'Form');
  const registerId = integerId(filter.registerId, 'Register');
  const userId = integerId(filter.userId, 'User');
  rejectForeignDivision(actor, divisionId);

  const where: Prisma.SubmissionWhereInput = {};
  const parts: Prisma.Sql[] = [];
  const scopedDivision = (id: number) => {
    where.divisionId = id;
    parts.push(Prisma.sql`"divisionId" = ${id}`);
  };
  if (role === 'SYSTEM_ADMIN') {
    if (divisionId != null) scopedDivision(divisionId);
  } else if (role === 'DIVISION_ADMIN' || role === 'DIVISION_MONITOR') {
    scopedDivision(actor.homeDivisionId ?? -1);
  } else if (role === 'LOBBY_USER') {
    scopedDivision(actor.homeDivisionId ?? -1);
    where.lobbyId = actor.homeLobbyId ?? -1;
    parts.push(Prisma.sql`"lobbyId" = ${actor.homeLobbyId ?? -1}`);
  } else if (role === 'CREW_USER') {
    scopedDivision(actor.homeDivisionId ?? -1);
    where.submittedById = actor.id;
    parts.push(Prisma.sql`"submittedById" = ${actor.id}`);
  } else {
    throw new RmoError(DENIED, 403);
  }

  if (lobbyId != null) {
    const lobby = await prisma.lobby.findUnique({
      where: { id: lobbyId },
      select: { id: true, divisionId: true },
    });
    if (!lobby) throw new RmoError('Lobby was not found.', 400);
    if (role !== 'SYSTEM_ADMIN' && lobby.divisionId !== actor.homeDivisionId) {
      throw new RmoError(DENIED, 403);
    }
    if ((role === 'LOBBY_USER' || role === 'CREW_USER') && lobby.id !== actor.homeLobbyId) {
      throw new RmoError(DENIED, 403);
    }
    if (typeof where.divisionId === 'number' && lobby.divisionId !== where.divisionId) {
      throw new RmoError(DENIED, 403);
    }
    where.lobbyId = lobby.id;
    parts.push(Prisma.sql`"lobbyId" = ${lobby.id}`);
  }

  if (registerId != null) {
    const register = await prisma.register.findUnique({
      where: { id: registerId },
      select: { id: true, divisionId: true, formId: true },
    });
    if (!register) throw new RmoError('Register was not found.', 400);
    if (role !== 'SYSTEM_ADMIN' && register.divisionId !== actor.homeDivisionId) {
      throw new RmoError(DENIED, 403);
    }
    if (formId != null && formId !== register.formId) {
      throw new RmoError('Register does not match the selected form.', 400);
    }
    if (typeof where.divisionId === 'number' && where.divisionId !== register.divisionId) {
      throw new RmoError(DENIED, 403);
    }
    where.formId = register.formId;
    where.divisionId = register.divisionId;
    parts.push(Prisma.sql`"formId" = ${register.formId}`);
    parts.push(Prisma.sql`"divisionId" = ${register.divisionId}`);
  }

  if (formId != null && registerId == null) {
    const form = await prisma.form.findUnique({
      where: { id: formId },
      select: { id: true, divisionId: true },
    });
    if (!form) throw new RmoError('Form was not found.', 400);
    if (role !== 'SYSTEM_ADMIN' && form.divisionId != null && form.divisionId !== actor.homeDivisionId) {
      throw new RmoError(DENIED, 403);
    }
    where.formId = form.id;
    parts.push(Prisma.sql`"formId" = ${form.id}`);
  }

  if (userId != null) {
    if (role === 'CREW_USER' && userId !== actor.id) throw new RmoError(DENIED, 403);
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, homeDivisionId: true, homeLobbyId: true },
    });
    if (!user) throw new RmoError('User was not found.', 400);
    if (role !== 'SYSTEM_ADMIN' && user.homeDivisionId !== actor.homeDivisionId) {
      throw new RmoError(DENIED, 403);
    }
    if (role === 'LOBBY_USER' && user.homeLobbyId !== actor.homeLobbyId) {
      throw new RmoError(DENIED, 403);
    }
    where.submittedById = user.id;
    parts.push(Prisma.sql`"submittedById" = ${user.id}`);
  }

  if (filter.status) {
    if (filter.status !== 'PENDING' && filter.status !== 'COMPLETED') {
      throw new RmoError('Status must be PENDING or COMPLETED.', 400);
    }
    where.status = filter.status as SubmissionStatus;
    parts.push(
      filter.status === 'PENDING'
        ? Prisma.sql`"status" = 'PENDING'::"SubmissionStatus"`
        : Prisma.sql`"status" = 'COMPLETED'::"SubmissionStatus"`,
    );
  }

  let from: Date | null = null;
  let to: Date | null = null;
  if (filter.dateFrom || filter.dateTo || options?.defaultDays) {
    const fallback = options?.defaultDays ? defaultRange(options.defaultDays) : null;
    from = filter.dateFrom ? dayStart(filter.dateFrom) : fallback?.from ?? null;
    to = filter.dateTo ? dayEnd(filter.dateTo) : fallback?.to ?? null;
    if (from && to && from > to) throw new RmoError('Date range is invalid.', 400);
    where.submittedAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
    if (from) parts.push(Prisma.sql`"submittedAt" >= ${from}`);
    if (to) parts.push(Prisma.sql`"submittedAt" <= ${to}`);
  }

  if (filter.search) {
    where.OR = [
      { form: { name: { contains: filter.search, mode: 'insensitive' } } },
      { submittedBy: { name: { contains: filter.search, mode: 'insensitive' } } },
      { submittedBy: { loginId: { contains: filter.search, mode: 'insensitive' } } },
    ];
    const term = `%${filter.search.replace(/[%_\\]/g, '')}%`;
    parts.push(Prisma.sql`(
      EXISTS (
        SELECT 1 FROM "Form" f
        WHERE f.id = "Submission"."formId" AND f.name ILIKE ${term}
      )
      OR EXISTS (
        SELECT 1 FROM "User" u
        WHERE u.id = "Submission"."submittedById"
          AND (u.name ILIKE ${term} OR u."loginId" ILIKE ${term})
      )
    )`);
  }

  return {
    where,
    from,
    to,
    sql: parts.length ? Prisma.join(parts, ' AND ') : Prisma.sql`TRUE`,
  };
}

export async function assignedFormIds(actor: Actor): Promise<number[]> {
  if (!actor.homeDivisionId || !actor.homeLobbyId) return [];
  const rows = await prisma.formAssignment.findMany({
    where: {
      divisionId: actor.homeDivisionId,
      form: { status: 'PUBLISHED' },
      OR: [{ lobbyId: null }, { lobbyId: actor.homeLobbyId }],
    },
    select: { formId: true },
  });
  return [...new Set(rows.map(row => row.formId))];
}
