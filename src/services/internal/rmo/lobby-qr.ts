import QRCode from 'qrcode';
import { prisma } from '@/lib/prisma';
import { canAccessLobby, isRmoRole, type RmoRoleName } from '@/lib/rmo/access';
import { RmoError } from '@/lib/rmo/errors';
import { generateLobbyPublicToken } from '@/lib/rmo/public-crew-form';
import type { Actor } from '@/services/internal/rmo/administration';
import { recordAudit } from '@/services/internal/rmo/audit-event';

const DENIED = 'You do not have permission to perform this action.';

function roleOf(actor: Actor): RmoRoleName {
  if (!isRmoRole(actor.rmoRole)) throw new RmoError('Unknown role.', 400);
  return actor.rmoRole;
}

function assertQrReader(actor: Actor): RmoRoleName {
  const role = roleOf(actor);
  if (
    role === 'SYSTEM_ADMIN' ||
    role === 'DIVISION_ADMIN' ||
    role === 'DIVISION_MONITOR' ||
    role === 'LOBBY_USER'
  ) {
    if (role !== 'SYSTEM_ADMIN' && !actor.homeDivisionId) throw new RmoError(DENIED, 403);
    if (role === 'LOBBY_USER' && !actor.homeLobbyId) throw new RmoError(DENIED, 403);
    return role;
  }
  throw new RmoError(DENIED, 403);
}

function assertQrManager(actor: Actor): RmoRoleName {
  const role = roleOf(actor);
  if (role === 'SYSTEM_ADMIN') return role;
  if (role === 'DIVISION_ADMIN' && actor.homeDivisionId) return role;
  throw new RmoError(DENIED, 403);
}

function appOrigin(): string {
  const raw =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.TEST_APP_URL ||
    'http://localhost:3000';
  return raw.replace(/\/$/, '');
}

export function publicCrewFormPath(token: string) {
  return `/public/crew-form/${encodeURIComponent(token)}`;
}

export function publicCrewFormUrl(token: string) {
  return `${appOrigin()}${publicCrewFormPath(token)}`;
}

async function ensureLobbyToken(lobbyId: number): Promise<string> {
  const lobby = await prisma.lobby.findUnique({
    where: { id: lobbyId },
    select: { id: true, publicToken: true, publicTokenRevokedAt: true },
  });
  if (!lobby) throw new RmoError('Lobby not found.', 404);
  if (lobby.publicToken && !lobby.publicTokenRevokedAt) return lobby.publicToken;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateLobbyPublicToken();
    try {
      const updated = await prisma.lobby.update({
        where: { id: lobbyId },
        data: { publicToken: token, publicTokenRevokedAt: null },
        select: { publicToken: true },
      });
      return updated.publicToken as string;
    } catch {
      // unique collision — retry
    }
  }
  throw new RmoError('Could not allocate a public lobby token.', 500);
}

function presentQr(lobby: {
  id: number;
  name: string;
  publicToken: string | null;
  division: { name: string };
}) {
  if (!lobby.publicToken) throw new RmoError('Lobby QR is unavailable.', 404);
  const path = publicCrewFormPath(lobby.publicToken);
  const url = publicCrewFormUrl(lobby.publicToken);
  return {
    lobbyId: lobby.id,
    lobbyName: lobby.name,
    divisionName: lobby.division.name,
    publicPath: path,
    publicUrl: url,
    instruction: 'Scan this QR code to submit the crew form.',
  };
}

export async function listAuthorizedLobbyQrs(actor: Actor) {
  assertQrReader(actor);
  const role = roleOf(actor);
  const where =
    role === 'SYSTEM_ADMIN'
      ? { status: 'ACTIVE' as const }
      : role === 'LOBBY_USER'
        ? { id: actor.homeLobbyId as number, status: 'ACTIVE' as const }
        : { divisionId: actor.homeDivisionId as number, status: 'ACTIVE' as const };

  const lobbies = await prisma.lobby.findMany({
    where,
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      divisionId: true,
      publicToken: true,
      publicTokenRevokedAt: true,
      division: { select: { name: true } },
    },
  });

  const items = [];
  for (const lobby of lobbies) {
    if (
      !canAccessLobby(
        {
          rmoRole: role,
          homeDivisionId: actor.homeDivisionId,
          homeLobbyId: actor.homeLobbyId,
        },
        lobby,
      )
    ) {
      continue;
    }
    const token = await ensureLobbyToken(lobby.id);
    items.push(
      presentQr({
        id: lobby.id,
        name: lobby.name,
        publicToken: token,
        division: lobby.division,
      }),
    );
  }
  return { items };
}

export async function getLobbyQr(actor: Actor, lobbyId: number) {
  assertQrReader(actor);
  if (!Number.isInteger(lobbyId)) throw new RmoError('Lobby not found.', 404);
  const lobby = await prisma.lobby.findUnique({
    where: { id: lobbyId },
    select: {
      id: true,
      name: true,
      divisionId: true,
      publicToken: true,
      publicTokenRevokedAt: true,
      division: { select: { name: true } },
    },
  });
  if (!lobby) throw new RmoError('Lobby not found.', 404);
  if (
    !canAccessLobby(
      {
        rmoRole: roleOf(actor),
        homeDivisionId: actor.homeDivisionId,
        homeLobbyId: actor.homeLobbyId,
      },
      lobby,
    )
  ) {
    throw new RmoError(DENIED, 403);
  }
  const token = await ensureLobbyToken(lobby.id);
  return presentQr({ ...lobby, publicToken: token });
}

export async function regenerateLobbyQr(actor: Actor, lobbyId: number) {
  assertQrManager(actor);
  if (!Number.isInteger(lobbyId)) throw new RmoError('Lobby not found.', 404);
  const lobby = await prisma.lobby.findUnique({
    where: { id: lobbyId },
    select: {
      id: true,
      name: true,
      divisionId: true,
      division: { select: { name: true } },
    },
  });
  if (!lobby) throw new RmoError('Lobby not found.', 404);
  if (
    !canAccessLobby(
      {
        rmoRole: roleOf(actor),
        homeDivisionId: actor.homeDivisionId,
        homeLobbyId: actor.homeLobbyId,
      },
      lobby,
    )
  ) {
    throw new RmoError(DENIED, 403);
  }

  const token = generateLobbyPublicToken();
  const updated = await prisma.lobby.update({
    where: { id: lobbyId },
    data: {
      publicToken: token,
      publicTokenRevokedAt: null,
    },
    select: {
      id: true,
      name: true,
      publicToken: true,
      division: { select: { name: true } },
    },
  });
  await recordAudit(actor.id, 'lobby.qr_regenerated', 'lobby', lobbyId, {
    divisionId: lobby.divisionId,
  });
  return presentQr(updated);
}

export async function renderLobbyQrPng(actor: Actor, lobbyId: number): Promise<Buffer> {
  const qr = await getLobbyQr(actor, lobbyId);
  return QRCode.toBuffer(qr.publicUrl, {
    type: 'png',
    width: 512,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
}
