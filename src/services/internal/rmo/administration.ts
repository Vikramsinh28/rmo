import { prisma } from '@/lib/prisma';
import {
  canAccessDivision,
  canAccessLobby,
  canAccessUser,
  canAdminister,
  canAssignRole,
  canManageDivisionUsers,
  isRmoRole,
  scopeForRole,
  validateRoleLocation,
  type HomeLocationInput,
  type RmoRoleName,
} from '@/lib/rmo/access';
import { RmoError } from '@/lib/rmo/errors';
import { hashPassword, validatePassword } from '@/lib/utils';
import { AccountStatus, OrgStatus, Prisma, RmoRole } from '@/lib/prisma/generated/client';

const userSelect = {
  id: true,
  loginId: true,
  email: true,
  name: true,
  role: true,
  rmoRole: true,
  accountStatus: true,
  homeZoneId: true,
  homeDivisionId: true,
  homeLobbyId: true,
  profilePicture: true,
  isOnboarded: true,
  createdAt: true,
  updatedAt: true,
  homeZone: { select: { id: true, name: true, code: true, status: true } },
  homeDivision: { select: { id: true, name: true, code: true, zoneId: true, status: true } },
  homeLobby: {
    select: { id: true, name: true, code: true, divisionId: true, status: true },
  },
} satisfies Prisma.UserSelect;

export type Actor = {
  id: number;
  rmoRole: RmoRole;
  homeZoneId: number | null;
  homeDivisionId: number | null;
  homeLobbyId: number | null;
  accountStatus: AccountStatus;
};

type ListQuery = {
  search?: string;
  status?: string;
  zoneId?: number;
  divisionId?: number;
  lobbyId?: number;
  role?: string;
  page?: number;
  pageSize?: number;
};

function pageArgs(query: ListQuery) {
  const page = Math.max(query.page || 1, 1);
  const pageSize = Math.min(Math.max(query.pageSize || 10, 1), 50);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function orgStatus(value: string | undefined): OrgStatus | undefined {
  if (value === 'ACTIVE' || value === 'DISABLED') return value;
  return undefined;
}

async function audit(
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

function statusAction(
  kind: 'zone' | 'division' | 'lobby',
  previous: OrgStatus,
  next: OrgStatus | undefined,
): string {
  if (next === 'DISABLED' && previous !== 'DISABLED') return `${kind}.disabled`;
  if (next === 'ACTIVE' && previous !== 'ACTIVE') return `${kind}.enabled`;
  return `${kind}.updated`;
}

async function lastSignIns(userIds: number[]) {
  const signedIn = new Map<number, string>();
  if (userIds.length === 0) return signedIn;
  const rows = await prisma.auditLog.findMany({
    where: { action: 'user.signed_in', targetId: { in: userIds.map(String) } },
    orderBy: { createdAt: 'desc' },
    select: { targetId: true, createdAt: true },
  });
  rows.forEach(row => {
    const id = Number(row.targetId);
    if (!signedIn.has(id)) signedIn.set(id, row.createdAt.toISOString());
  });
  return signedIn;
}

function assertSystem(actor: Actor) {
  if (!isRmoRole(actor.rmoRole) || !canAdminister(actor.rmoRole)) {
    throw new RmoError('You do not have permission to perform this action.', 403);
  }
}

function asRole(role: RmoRole): RmoRoleName {
  if (!isRmoRole(role)) {
    throw new RmoError('Unknown role.', 400);
  }
  return role;
}

export async function listZones(actor: Actor, query: ListQuery) {
  assertSystem(actor);
  const { page, pageSize, skip, take } = pageArgs(query);
  const where: Prisma.ZoneWhereInput = {
    ...(orgStatus(query.status) ? { status: orgStatus(query.status) } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.zone.findMany({ where, orderBy: { name: 'asc' }, skip, take }),
    prisma.zone.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function createZone(actor: Actor, input: { name: string; code: string }) {
  assertSystem(actor);
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!name || !code) throw new RmoError('Name and code are required.', 400);
  try {
    const zone = await prisma.zone.create({ data: { name, code } });
    await audit(actor.id, 'zone.created', 'zone', zone.id, { name, code });
    return zone;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new RmoError('A zone with this code already exists.', 400);
    }
    throw error;
  }
}

export async function updateZone(
  actor: Actor,
  id: number,
  input: { name?: string; code?: string; status?: string },
) {
  assertSystem(actor);
  const existing = await prisma.zone.findUnique({ where: { id } });
  if (!existing) throw new RmoError('Zone not found.', 404);
  const status = input.status ? orgStatus(input.status) : undefined;
  if (input.status && !status) throw new RmoError('Status must be ACTIVE or DISABLED.', 400);
  try {
    const zone = await prisma.zone.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.code ? { code: input.code.trim().toUpperCase() } : {}),
        ...(status ? { status } : {}),
      },
    });
    const action = statusAction('zone', existing.status, status);
    await audit(actor.id, action, 'zone', zone.id, {
      name: zone.name,
      code: zone.code,
      status: zone.status,
    });
    return zone;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new RmoError('A zone with this code already exists.', 400);
    }
    throw error;
  }
}

export async function listDivisions(actor: Actor, query: ListQuery) {
  const role = asRole(actor.rmoRole);
  const { page, pageSize, skip, take } = pageArgs(query);
  const where: Prisma.DivisionWhereInput = {
    ...(orgStatus(query.status) ? { status: orgStatus(query.status) } : {}),
    ...(query.zoneId ? { zoneId: query.zoneId } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  if (!canAdminister(role)) {
    if (scopeForRole(role) !== 'division' || !actor.homeDivisionId) {
      throw new RmoError('You do not have permission to perform this action.', 403);
    }
    where.id = actor.homeDivisionId;
  }
  const [items, total] = await Promise.all([
    prisma.division.findMany({
      where,
      orderBy: { name: 'asc' },
      skip,
      take,
      include: { zone: { select: { id: true, name: true, code: true } } },
    }),
    prisma.division.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getDivision(actor: Actor, id: number) {
  const division = await prisma.division.findUnique({
    where: { id },
    include: { zone: { select: { id: true, name: true, code: true } } },
  });
  if (!division) throw new RmoError('Division not found.', 404);
  if (!canAccessDivision({ rmoRole: asRole(actor.rmoRole), homeDivisionId: actor.homeDivisionId }, id)) {
    throw new RmoError('You do not have permission to perform this action.', 403);
  }
  return division;
}

export async function createDivision(
  actor: Actor,
  input: { zoneId: number; name: string; code: string },
) {
  assertSystem(actor);
  const zone = await prisma.zone.findUnique({ where: { id: input.zoneId } });
  if (!zone) throw new RmoError('Zone was not found.', 400);
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  if (!name || !code) throw new RmoError('Name and code are required.', 400);
  try {
    const division = await prisma.division.create({
      data: { zoneId: zone.id, name, code },
      include: { zone: { select: { id: true, name: true, code: true } } },
    });
    await audit(actor.id, 'division.created', 'division', division.id, {
      name,
      code,
      zoneId: zone.id,
    });
    return division;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new RmoError('A division with this code already exists in the zone.', 400);
    }
    throw error;
  }
}

export async function updateDivision(
  actor: Actor,
  id: number,
  input: { name?: string; code?: string; status?: string; zoneId?: number },
) {
  assertSystem(actor);
  const existing = await prisma.division.findUnique({ where: { id } });
  if (!existing) throw new RmoError('Division not found.', 404);
  if (input.zoneId) {
    const zone = await prisma.zone.findUnique({ where: { id: input.zoneId } });
    if (!zone) throw new RmoError('Zone was not found.', 400);
  }
  const status = input.status ? orgStatus(input.status) : undefined;
  if (input.status && !status) throw new RmoError('Status must be ACTIVE or DISABLED.', 400);
  try {
    const division = await prisma.division.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.code ? { code: input.code.trim().toUpperCase() } : {}),
        ...(status ? { status } : {}),
        ...(input.zoneId ? { zoneId: input.zoneId } : {}),
      },
      include: { zone: { select: { id: true, name: true, code: true } } },
    });
    const action = statusAction('division', existing.status, status);
    await audit(actor.id, action, 'division', division.id, {
      name: division.name,
      code: division.code,
      status: division.status,
      zoneId: division.zoneId,
    });
    return division;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new RmoError('A division with this code already exists in the zone.', 400);
    }
    throw error;
  }
}

export async function listLobbies(actor: Actor, query: ListQuery) {
  const role = asRole(actor.rmoRole);
  const { page, pageSize, skip, take } = pageArgs(query);
  const where: Prisma.LobbyWhereInput = {
    ...(orgStatus(query.status) ? { status: orgStatus(query.status) } : {}),
    ...(query.divisionId ? { divisionId: query.divisionId } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  if (canAdminister(role)) {
    // System Admin sees every lobby.
  } else if (scopeForRole(role) === 'division') {
    if (!actor.homeDivisionId) {
      throw new RmoError('You do not have permission to perform this action.', 403);
    }
    where.divisionId = actor.homeDivisionId;
  } else if (actor.homeLobbyId) {
    where.id = actor.homeLobbyId;
  } else {
    throw new RmoError('You do not have permission to perform this action.', 403);
  }
  const [items, total] = await Promise.all([
    prisma.lobby.findMany({
      where,
      orderBy: { name: 'asc' },
      skip,
      take,
      include: {
        division: {
          select: {
            id: true,
            name: true,
            code: true,
            zoneId: true,
            zone: { select: { id: true, name: true, code: true } },
          },
        },
      },
    }),
    prisma.lobby.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getLobby(actor: Actor, id: number) {
  const lobby = await prisma.lobby.findUnique({
    where: { id },
    include: {
      division: {
        select: {
          id: true,
          name: true,
          code: true,
          zoneId: true,
          zone: { select: { id: true, name: true, code: true } },
        },
      },
    },
  });
  if (!lobby) throw new RmoError('Lobby not found.', 404);
  if (
    !canAccessLobby(
      {
        rmoRole: asRole(actor.rmoRole),
        homeDivisionId: actor.homeDivisionId,
        homeLobbyId: actor.homeLobbyId,
      },
      lobby,
    )
  ) {
    throw new RmoError('You do not have permission to perform this action.', 403);
  }
  return lobby;
}

export async function createLobby(
  actor: Actor,
  input: { divisionId: number; name: string; code: string },
) {
  assertSystem(actor);
  const division = await prisma.division.findUnique({ where: { id: input.divisionId } });
  if (!division) throw new RmoError('Division was not found.', 400);
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  if (!name || !code) throw new RmoError('Name and code are required.', 400);
  try {
    const lobby = await prisma.lobby.create({
      data: { divisionId: division.id, name, code },
      include: {
        division: {
          select: { id: true, name: true, code: true, zoneId: true },
        },
      },
    });
    await audit(actor.id, 'lobby.created', 'lobby', lobby.id, {
      name,
      code,
      divisionId: division.id,
    });
    return lobby;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new RmoError('A lobby with this code already exists in the division.', 400);
    }
    throw error;
  }
}

export async function updateLobby(
  actor: Actor,
  id: number,
  input: { name?: string; code?: string; status?: string; divisionId?: number },
) {
  assertSystem(actor);
  const existing = await prisma.lobby.findUnique({ where: { id } });
  if (!existing) throw new RmoError('Lobby not found.', 404);
  if (input.divisionId) {
    const division = await prisma.division.findUnique({ where: { id: input.divisionId } });
    if (!division) throw new RmoError('Division was not found.', 400);
  }
  const status = input.status ? orgStatus(input.status) : undefined;
  if (input.status && !status) throw new RmoError('Status must be ACTIVE or DISABLED.', 400);
  try {
    const lobby = await prisma.lobby.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.code ? { code: input.code.trim().toUpperCase() } : {}),
        ...(status ? { status } : {}),
        ...(input.divisionId ? { divisionId: input.divisionId } : {}),
      },
    });
    const action = statusAction('lobby', existing.status, status);
    await audit(actor.id, action, 'lobby', lobby.id, {
      name: lobby.name,
      code: lobby.code,
      status: lobby.status,
      divisionId: lobby.divisionId,
    });
    return lobby;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new RmoError('A lobby with this code already exists in the division.', 400);
    }
    throw error;
  }
}

async function resolveLocation(role: RmoRoleName, input: HomeLocationInput) {
  const zone = input.homeZoneId
    ? await prisma.zone.findUnique({ where: { id: input.homeZoneId } })
    : null;
  const division = input.homeDivisionId
    ? await prisma.division.findUnique({ where: { id: input.homeDivisionId } })
    : null;
  const lobby = input.homeLobbyId
    ? await prisma.lobby.findUnique({ where: { id: input.homeLobbyId } })
    : null;
  const message = validateRoleLocation(role, input, {
    zoneId: zone?.id,
    divisionId: division?.id,
    divisionZoneId: division?.zoneId,
    lobbyId: lobby?.id,
    lobbyDivisionId: lobby?.divisionId,
  });
  if (message) throw new RmoError(message, 400);
  return { zone, division, lobby };
}

export async function listUsers(actor: Actor, query: ListQuery & { role?: string }) {
  const role = asRole(actor.rmoRole);
  if (!canAdminister(role) && !canManageDivisionUsers(role)) {
    throw new RmoError('You do not have permission to perform this action.', 403);
  }
  const { page, pageSize, skip, take } = pageArgs(query);
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(query.status === 'ACTIVE' || query.status === 'DISABLED'
      ? { accountStatus: query.status }
      : {}),
    ...(query.role && isRmoRole(query.role) ? { rmoRole: query.role } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { loginId: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  if (!canAdminister(role)) {
    where.homeDivisionId = actor.homeDivisionId;
  }
  if (query.lobbyId) {
    const lobby = await prisma.lobby.findUnique({ where: { id: query.lobbyId } });
    if (!lobby) throw new RmoError('Lobby was not found.', 400);
    if (!canAdminister(role) && lobby.divisionId !== actor.homeDivisionId) {
      throw new RmoError('You do not have permission to perform this action.', 403);
    }
    where.homeLobbyId = lobby.id;
  }
  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { name: 'asc' }, skip, take, select: userSelect }),
    prisma.user.count({ where }),
  ]);
  const signedIn = await lastSignIns(rows.map(row => row.id));
  const items = rows.map(row => ({ ...row, lastLoginAt: signedIn.get(row.id) ?? null }));
  return { items, total, page, pageSize };
}

export async function getUser(actor: Actor, id: number) {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: userSelect,
  });
  if (!user) throw new RmoError('User not found.', 404);
  if (
    !canAccessUser(
      { id: actor.id, rmoRole: asRole(actor.rmoRole), homeDivisionId: actor.homeDivisionId },
      user,
    )
  ) {
    throw new RmoError('You do not have permission to perform this action.', 403);
  }
  const signedIn = await lastSignIns([user.id]);
  return { ...user, lastLoginAt: signedIn.get(user.id) ?? null };
}

export interface UserWriteInput extends HomeLocationInput {
  name: string;
  email: string;
  loginId: string;
  password?: string;
  rmoRole: string;
  accountStatus?: string;
}

export async function createDirectoryUser(actor: Actor, input: UserWriteInput) {
  const actorRole = asRole(actor.rmoRole);
  if (!isRmoRole(input.rmoRole)) throw new RmoError('Role is not valid.', 400);
  if (!canAssignRole(actorRole, input.rmoRole)) {
    throw new RmoError('You do not have permission to assign this role.', 403);
  }
  if (canManageDivisionUsers(actorRole) && input.homeLobbyId) {
    const lobby = await prisma.lobby.findUnique({ where: { id: input.homeLobbyId } });
    if (!lobby || lobby.divisionId !== actor.homeDivisionId) {
      throw new RmoError('You can only assign a lobby inside your division.', 403);
    }
  }
  if (canManageDivisionUsers(actorRole)) {
    if (!actor.homeDivisionId || input.homeDivisionId !== actor.homeDivisionId) {
      throw new RmoError('You can only create users inside your division.', 403);
    }
    if (actor.homeZoneId && input.homeZoneId !== actor.homeZoneId) {
      throw new RmoError('You can only create users inside your zone.', 403);
    }
  }
  const location = await resolveLocation(input.rmoRole, input);
  if (canManageDivisionUsers(actorRole)) {
    if (location.division?.id !== actor.homeDivisionId) {
      throw new RmoError('You can only create users inside your division.', 403);
    }
  }
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const loginId = input.loginId.trim();
  if (!name || !email || !loginId) {
    throw new RmoError('Name, user ID, and email are required.', 400);
  }
  if (!input.password) throw new RmoError('Password is required.', 400);
  const passwordCheck = validatePassword(input.password);
  if (!passwordCheck.isValid) {
    throw new RmoError(passwordCheck.errors.join(', '), 400);
  }
  const password = await hashPassword(input.password);
  try {
    const user = await prisma.user.create({
      data: {
        name,
        email,
        loginId,
        password,
        role: 'USER',
        rmoRole: input.rmoRole,
        accountStatus: 'ACTIVE',
        isOnboarded: true,
        homeZoneId: location.zone?.id ?? null,
        homeDivisionId: location.division?.id ?? null,
        homeLobbyId: location.lobby?.id ?? null,
      },
      select: userSelect,
    });
    await audit(actor.id, 'user.created', 'user', user.id, {
      loginId,
      email,
      rmoRole: user.rmoRole,
      divisionId: user.homeDivisionId,
      homeZoneId: user.homeZoneId,
      homeDivisionId: user.homeDivisionId,
      homeLobbyId: user.homeLobbyId,
      after: {
        rmoRole: user.rmoRole,
        homeDivisionId: user.homeDivisionId,
        homeLobbyId: user.homeLobbyId,
        accountStatus: user.accountStatus,
      },
    });
    return user;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new RmoError('A user with this email or user ID already exists.', 400);
    }
    throw error;
  }
}

export async function updateDirectoryUser(
  actor: Actor,
  id: number,
  input: Partial<UserWriteInput>,
) {
  const actorRole = asRole(actor.rmoRole);
  if (!canAdminister(actorRole) && !canManageDivisionUsers(actorRole)) {
    throw new RmoError('You do not have permission to perform this action.', 403);
  }
  const existing = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new RmoError('User not found.', 404);
  if (canManageDivisionUsers(actorRole)) {
    if (existing.homeDivisionId !== actor.homeDivisionId) {
      throw new RmoError('You do not have permission to perform this action.', 403);
    }
    if (existing.id !== actor.id && !canAssignRole(actorRole, asRole(existing.rmoRole))) {
      throw new RmoError('You do not have permission to perform this action.', 403);
    }
  }

  let requestedRole: RmoRoleName | undefined;
  if (input.rmoRole !== undefined) {
    if (!isRmoRole(input.rmoRole)) {
      throw new RmoError('Role is not valid.', 400);
    }
    requestedRole = input.rmoRole;
  }
  if (requestedRole && requestedRole !== existing.rmoRole) {
    if (actor.id === existing.id) {
      throw new RmoError('You cannot change your own role.', 403);
    }
    if (!canAssignRole(actorRole, requestedRole)) {
      throw new RmoError('You do not have permission to assign this role.', 403);
    }
  }
  if (
    actor.id === existing.id &&
    input.homeDivisionId &&
    input.homeDivisionId !== existing.homeDivisionId
  ) {
    throw new RmoError('You cannot move your own division assignment.', 403);
  }

  if (
    canManageDivisionUsers(actorRole) &&
    input.homeLobbyId &&
    input.homeLobbyId !== existing.homeLobbyId
  ) {
    const lobby = await prisma.lobby.findUnique({ where: { id: input.homeLobbyId } });
    if (!lobby || lobby.divisionId !== actor.homeDivisionId) {
      throw new RmoError('You can only assign a lobby inside your division.', 403);
    }
  }
  const nextRole = (input.rmoRole as RmoRoleName) || asRole(existing.rmoRole);
  if (
    canManageDivisionUsers(actorRole) &&
    input.homeDivisionId &&
    input.homeDivisionId !== actor.homeDivisionId
  ) {
    throw new RmoError('You cannot move a user outside your division.', 403);
  }
  const locationInput: HomeLocationInput = {
    homeZoneId: input.homeZoneId === undefined ? existing.homeZoneId : input.homeZoneId,
    homeDivisionId:
      input.homeDivisionId === undefined ? existing.homeDivisionId : input.homeDivisionId,
    homeLobbyId: input.homeLobbyId === undefined ? existing.homeLobbyId : input.homeLobbyId,
  };
  const location = await resolveLocation(nextRole, locationInput);
  if (canManageDivisionUsers(actorRole) && location.division?.id !== actor.homeDivisionId) {
    throw new RmoError('You cannot move a user outside your division.', 403);
  }
  const status =
    input.accountStatus === 'ACTIVE' || input.accountStatus === 'DISABLED'
      ? input.accountStatus
      : undefined;
  if (input.accountStatus && !status) {
    throw new RmoError('Status must be ACTIVE or DISABLED.', 400);
  }
  if (actor.id === existing.id && status === 'DISABLED') {
    throw new RmoError('You cannot disable your own account.', 403);
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(input.email ? { email: input.email.trim().toLowerCase() } : {}),
      ...(input.loginId ? { loginId: input.loginId.trim() } : {}),
      ...(requestedRole
        ? {
            rmoRole: requestedRole,
          }
        : {}),
      ...(status ? { accountStatus: status } : {}),
      homeZoneId: location.zone?.id ?? null,
      homeDivisionId: location.division?.id ?? null,
      homeLobbyId: location.lobby?.id ?? null,
    },
    select: userSelect,
  });

  if (input.rmoRole && input.rmoRole !== existing.rmoRole) {
    await audit(actor.id, 'user.role_changed', 'user', user.id, {
      divisionId: user.homeDivisionId,
      before: { rmoRole: existing.rmoRole },
      after: { rmoRole: user.rmoRole },
    });
  }
  if (status && status !== existing.accountStatus) {
    await audit(actor.id, status === 'DISABLED' ? 'user.disabled' : 'user.enabled', 'user', user.id, {
      divisionId: user.homeDivisionId,
      before: { accountStatus: existing.accountStatus },
      after: { accountStatus: status },
    });
  }
  await audit(actor.id, 'user.updated', 'user', user.id, {
    divisionId: user.homeDivisionId,
    before: {
      name: existing.name,
      rmoRole: existing.rmoRole,
      accountStatus: existing.accountStatus,
      homeDivisionId: existing.homeDivisionId,
      homeLobbyId: existing.homeLobbyId,
    },
    after: {
      name: user.name,
      rmoRole: user.rmoRole,
      accountStatus: user.accountStatus,
      homeDivisionId: user.homeDivisionId,
      homeLobbyId: user.homeLobbyId,
    },
  });
  return user;
}

export async function resetUserPassword(actor: Actor, id: number, password: string) {
  const actorRole = asRole(actor.rmoRole);
  const existing = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new RmoError('User not found.', 404);
  if (canManageDivisionUsers(actorRole)) {
    if (existing.homeDivisionId !== actor.homeDivisionId) {
      throw new RmoError('You do not have permission to perform this action.', 403);
    }
    if (!canAssignRole(actorRole, asRole(existing.rmoRole))) {
      throw new RmoError('You do not have permission to perform this action.', 403);
    }
  } else {
    assertSystem(actor);
  }
  const passwordCheck = validatePassword(password);
  if (!passwordCheck.isValid) {
    throw new RmoError(passwordCheck.errors.join(', '), 400);
  }
  const hashed = await hashPassword(password);
  await prisma.user.update({ where: { id }, data: { password: hashed } });
  await audit(actor.id, 'user.password_reset', 'user', id, {
    divisionId: existing.homeDivisionId,
    loginId: existing.loginId,
  });
  return { id };
}

export async function listAuditLogs(actor: Actor, query: ListQuery) {
  assertSystem(actor);
  const { page, pageSize, skip, take } = pageArgs(query);
  const where: Prisma.AuditLogWhereInput = query.search
    ? {
        OR: [
          { action: { contains: query.search, mode: 'insensitive' } },
          { targetType: { contains: query.search, mode: 'insensitive' } },
        ],
      }
    : {};
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { actor: { select: { id: true, name: true, loginId: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function dashboardSummary(actor: Actor) {
  assertSystem(actor);
  const [zones, divisions, lobbies, users, activeUsers, disabledUsers, activity] =
    await Promise.all([
      prisma.zone.count(),
      prisma.division.count(),
      prisma.lobby.count(),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null, accountStatus: 'ACTIVE' } }),
      prisma.user.count({ where: { deletedAt: null, accountStatus: 'DISABLED' } }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { actor: { select: { id: true, name: true, loginId: true } } },
      }),
    ]);
  return { zones, divisions, lobbies, users, activeUsers, disabledUsers, activity };
}

export async function divisionSummary(actor: Actor) {
  const role = asRole(actor.rmoRole);
  if (scopeForRole(role) !== 'division' || !actor.homeDivisionId) {
    throw new RmoError('You do not have permission to perform this action.', 403);
  }
  const division = await getDivision(actor, actor.homeDivisionId);
  const divisionId = actor.homeDivisionId;
  const [lobbies, users, activeUsers, disabledUsers, cameras, kiosks, activity] =
    await Promise.all([
      prisma.lobby.count({ where: { divisionId } }),
      prisma.user.count({ where: { deletedAt: null, homeDivisionId: divisionId } }),
      prisma.user.count({
        where: { deletedAt: null, homeDivisionId: divisionId, accountStatus: 'ACTIVE' },
      }),
      prisma.user.count({
        where: { deletedAt: null, homeDivisionId: divisionId, accountStatus: 'DISABLED' },
      }),
      prisma.device.count({ where: { deviceType: 'CAMERA', lobby: { divisionId } } }),
      prisma.device.count({ where: { deviceType: 'KIOSK', lobby: { divisionId } } }),
      prisma.auditLog.findMany({
        where: { metadata: { path: ['divisionId'], equals: divisionId } },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { actor: { select: { id: true, name: true, loginId: true } } },
      }),
    ]);
  return {
    division,
    lobbies,
    users,
    activeUsers,
    disabledUsers,
    cameras,
    kiosks,
    health: null,
    activity,
  };
}

export { userSelect };
