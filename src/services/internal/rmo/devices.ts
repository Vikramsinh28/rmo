import { prisma } from '@/lib/prisma';
import { canAdminister, isRmoRole } from '@/lib/rmo/access';
import { RmoError } from '@/lib/rmo/errors';
import { DeviceType, Prisma } from '@/lib/prisma/generated/client';
import type { Actor } from '@/services/internal/rmo/administration';

export type DeviceKind = 'CAMERA' | 'KIOSK';

const deviceSelect = {
  id: true,
  name: true,
  deviceType: true,
  lobbyId: true,
  streamUrl: true,
  displayOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  lobby: {
    select: {
      id: true,
      name: true,
      code: true,
      divisionId: true,
      division: { select: { id: true, name: true, code: true } },
    },
  },
} satisfies Prisma.DeviceSelect;

function assertDeviceManager(actor: Actor) {
  if (!isRmoRole(actor.rmoRole)) throw new RmoError('Unknown role.', 400);
  if (canAdminister(actor.rmoRole)) return;
  if (actor.rmoRole === 'DIVISION_ADMIN' && actor.homeDivisionId) return;
  throw new RmoError('You do not have permission to perform this action.', 403);
}

function assertDeviceReader(actor: Actor) {
  if (!isRmoRole(actor.rmoRole)) throw new RmoError('Unknown role.', 400);
  if (canAdminister(actor.rmoRole)) return;
  if (
    (actor.rmoRole === 'DIVISION_ADMIN' || actor.rmoRole === 'DIVISION_MONITOR') &&
    actor.homeDivisionId
  ) {
    return;
  }
  throw new RmoError('You do not have permission to perform this action.', 403);
}

async function lobbyInScope(actor: Actor, lobbyId: number) {
  const lobby = await prisma.lobby.findUnique({
    where: { id: lobbyId },
    select: { id: true, divisionId: true, name: true },
  });
  if (!lobby) throw new RmoError('Lobby was not found.', 400);
  if (actor.rmoRole === 'SYSTEM_ADMIN') return lobby;
  if (lobby.divisionId !== actor.homeDivisionId) {
    throw new RmoError('You do not have permission to perform this action.', 403);
  }
  return lobby;
}

function asDeviceType(value: string | undefined): DeviceType | undefined {
  if (value === 'CAMERA' || value === 'KIOSK') return value;
  return undefined;
}

export async function listDevices(
  actor: Actor,
  query: { search?: string; lobbyId?: number; deviceType?: string; status?: string; page?: number; pageSize?: number },
) {
  assertDeviceReader(actor);
  const page = Math.max(query.page || 1, 1);
  const pageSize = Math.min(Math.max(query.pageSize || 50, 1), 50);
  const deviceType = asDeviceType(query.deviceType);
  if (query.deviceType && !deviceType) throw new RmoError('Device type must be CAMERA or KIOSK.', 400);
  const where: Prisma.DeviceWhereInput = {
    ...(deviceType ? { deviceType } : {}),
    ...(query.status === 'ACTIVE' ? { isActive: true } : {}),
    ...(query.status === 'DISABLED' ? { isActive: false } : {}),
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    ...(query.lobbyId ? { lobbyId: query.lobbyId } : {}),
  };
  if (actor.rmoRole !== 'SYSTEM_ADMIN') {
    where.lobby = { divisionId: actor.homeDivisionId ?? -1 };
  }
  if (query.lobbyId) {
    await lobbyInScope(actor, query.lobbyId);
  }
  const [items, total] = await Promise.all([
    prisma.device.findMany({
      where,
      orderBy: [{ lobbyId: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: deviceSelect,
    }),
    prisma.device.count({ where }),
  ]);
  return {
    items: items.map(item => ({ ...item, health: null })),
    total,
    page,
    pageSize,
  };
}

export interface DeviceWriteInput {
  name: string;
  deviceType: string;
  lobbyId: number;
  streamUrl: string;
  displayOrder?: number;
  isActive?: boolean;
}

async function auditDevice(
  actorId: number,
  action: string,
  deviceId: number,
  divisionId: number,
  metadata: Prisma.InputJsonValue,
) {
  await prisma.auditLog.create({
    data: {
      actorId,
      action,
      targetType: 'device',
      targetId: String(deviceId),
      metadata: { divisionId, ...(metadata as object) } as Prisma.InputJsonValue,
    },
  });
}

function publicDevice(device: {
  name: string;
  deviceType: DeviceType;
  lobbyId: number;
  displayOrder: number;
  isActive: boolean;
}) {
  return {
    name: device.name,
    deviceType: device.deviceType,
    lobbyId: device.lobbyId,
    displayOrder: device.displayOrder,
    isActive: device.isActive,
  };
}

export async function createDevice(actor: Actor, input: DeviceWriteInput) {
  assertDeviceManager(actor);
  const deviceType = asDeviceType(input.deviceType);
  if (!deviceType) throw new RmoError('Device type must be CAMERA or KIOSK.', 400);
  const name = input.name?.trim();
  const streamUrl = input.streamUrl?.trim();
  if (!name || !streamUrl) throw new RmoError('Name and stream URL are required.', 400);
  const lobby = await lobbyInScope(actor, Number(input.lobbyId));
  const device = await prisma.device.create({
    data: {
      name,
      deviceType,
      lobbyId: lobby.id,
      streamUrl,
      displayOrder: Number.isFinite(input.displayOrder) ? Number(input.displayOrder) : 0,
      isActive: input.isActive !== false,
    },
    select: deviceSelect,
  });
  await auditDevice(actor.id, 'device.created', device.id, lobby.divisionId, {
    after: publicDevice(device),
  });
  return { ...device, health: null };
}

async function loadScopedDevice(actor: Actor, id: number) {
  assertDeviceManager(actor);
  const device = await prisma.device.findUnique({ where: { id }, select: deviceSelect });
  if (!device) throw new RmoError('Device not found.', 404);
  if (
    actor.rmoRole !== 'SYSTEM_ADMIN' &&
    device.lobby.divisionId !== actor.homeDivisionId
  ) {
    throw new RmoError('You do not have permission to perform this action.', 403);
  }
  return device;
}

export async function updateDevice(
  actor: Actor,
  id: number,
  input: Partial<DeviceWriteInput>,
) {
  const existing = await loadScopedDevice(actor, id);
  const deviceType = input.deviceType ? asDeviceType(input.deviceType) : existing.deviceType;
  if (input.deviceType && !deviceType) throw new RmoError('Device type must be CAMERA or KIOSK.', 400);
  const lobbyId = input.lobbyId === undefined ? existing.lobbyId : Number(input.lobbyId);
  const lobby = await lobbyInScope(actor, lobbyId);
  const name = input.name === undefined ? existing.name : input.name.trim();
  const streamUrl = input.streamUrl === undefined ? existing.streamUrl : input.streamUrl.trim();
  if (!name || !streamUrl) throw new RmoError('Name and stream URL are required.', 400);
  const device = await prisma.device.update({
    where: { id },
    data: {
      name,
      deviceType,
      lobbyId: lobby.id,
      streamUrl,
      ...(input.displayOrder !== undefined ? { displayOrder: Number(input.displayOrder) } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    select: deviceSelect,
  });
  const turnedOff = existing.isActive && !device.isActive;
  const turnedOn = !existing.isActive && device.isActive;
  const action = turnedOff ? 'device.disabled' : turnedOn ? 'device.enabled' : 'device.updated';
  await auditDevice(actor.id, action, device.id, lobby.divisionId, {
    before: publicDevice(existing),
    after: publicDevice(device),
    streamUrlChanged: existing.streamUrl !== device.streamUrl,
  });
  return { ...device, health: null };
}

export async function setDeviceActive(actor: Actor, id: number, isActive: boolean) {
  return updateDevice(actor, id, { isActive });
}
