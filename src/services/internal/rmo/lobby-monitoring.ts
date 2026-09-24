import {
  appendCallSignal,
  clearCallSignals,
  readCallSignals,
} from '@/lib/rmo/call-signals';
import { publishMonitoringEvent } from '@/lib/rmo/monitoring-events';
import { mintLiveKitToken } from '@/lib/rmo/livekit';
import { RmoError } from '@/lib/rmo/errors';
import { prisma } from '@/lib/prisma';
import {
  CallConnection,
  LobbyCallStatus,
  LobbyPresence,
  Prisma,
} from '@/lib/prisma/generated/client';
import { Actor } from '@/services/internal/rmo/administration';
import {
  isPlayableRecording,
  readRecordingArtifact,
  recordingStorageKey,
  writeRecordingArtifact,
  writeRecordingMedia,
} from '@/services/internal/rmo/recording-pipeline';

const PRESENCE_MS = 45_000;
const OPEN_CALL: LobbyCallStatus[] = ['RINGING', 'CONNECTED'];

const callInclude = {
  monitor: { select: { id: true, name: true } },
  endedBy: { select: { id: true, name: true } },
  lobby: {
    select: {
      id: true,
      name: true,
      code: true,
      divisionId: true,
      division: { select: { id: true, name: true, zoneId: true, zone: { select: { id: true, name: true } } } },
    },
  },
  room: { select: { id: true, roomKey: true, status: true, presence: true, lastSeenAt: true } },
  participants: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { joinedAt: 'asc' as const },
  },
  recordings: { orderBy: { startedAt: 'asc' as const } },
} satisfies Prisma.LobbyCallInclude;

type CallRecord = Prisma.LobbyCallGetPayload<{ include: typeof callInclude }>;

function deny(message = 'You do not have access to this lobby.'): never {
  throw new RmoError(message, 403);
}

function presenceOf(presence: LobbyPresence, lastSeenAt: Date | null) {
  if (!lastSeenAt) return 'OFFLINE' as const;
  if (Date.now() - lastSeenAt.getTime() > PRESENCE_MS) return 'OFFLINE' as const;
  return presence;
}

function callUiState(status: LobbyCallStatus, connection: CallConnection) {
  if (status === 'RINGING') return 'RINGING';
  if (status === 'CONNECTED' && connection === 'RECONNECTING') return 'RECONNECTING';
  if (status === 'CONNECTED') return 'CONNECTED';
  if (status === 'FAILED') return 'FAILED';
  return 'ENDED';
}

function recordingState(recordings: { status: string }[]) {
  if (recordings.some(item => item.status === 'RECORDING')) return 'RECORDING';
  if (recordings.at(-1)?.status === 'FAILED') return 'FAILED';
  if (recordings.some(item => item.status === 'COMPLETED')) return 'COMPLETED';
  return 'OFF';
}

function canReadDivision(actor: Actor, divisionId: number) {
  if (actor.rmoRole === 'SYSTEM_ADMIN') return true;
  if (actor.rmoRole === 'DIVISION_ADMIN' || actor.rmoRole === 'DIVISION_MONITOR') {
    return actor.homeDivisionId === divisionId;
  }
  return false;
}

function assertReadableLobby(actor: Actor, lobby: { id: number; divisionId: number }) {
  if (actor.rmoRole === 'SUPER_ADMIN') deny();
  if (actor.rmoRole === 'SYSTEM_ADMIN') return;
  if (actor.rmoRole === 'DIVISION_ADMIN' || actor.rmoRole === 'DIVISION_MONITOR') {
    if (actor.homeDivisionId !== lobby.divisionId) deny();
    return;
  }
  if (actor.rmoRole === 'LOBBY_USER' || actor.rmoRole === 'CREW_USER') {
    if (actor.homeLobbyId !== lobby.id) deny();
    return;
  }
  deny();
}

async function audit(
  actorId: number,
  action: string,
  targetId: number,
  metadata: Prisma.InputJsonValue,
) {
  await prisma.auditLog.create({
    data: {
      actorId,
      action,
      targetType: 'LobbyCall',
      targetId: String(targetId),
      metadata,
    },
  });
}

function emit(
  type: string,
  call: { id: number; lobbyId: number; divisionId: number },
  recordingId?: number,
) {
  publishMonitoringEvent({
    type,
    divisionId: call.divisionId,
    lobbyId: call.lobbyId,
    callId: call.id,
    recordingId,
  });
}

async function loadLobby(lobbyId: number) {
  const lobby = await prisma.lobby.findUnique({
    where: { id: lobbyId },
    include: {
      division: { include: { zone: true } },
      room: true,
    },
  });
  if (!lobby) throw new RmoError('Lobby not found.', 404);
  return lobby;
}

async function ensureRoom(lobby: {
  id: number;
  status: 'ACTIVE' | 'DISABLED';
  room: {
    id: number;
    lobbyId: number;
    roomKey: string;
    status: 'ACTIVE' | 'DISABLED';
    presence: 'ONLINE' | 'OFFLINE' | 'CONNECTING';
    lastSeenAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
}) {
  const next = lobby.status === 'ACTIVE' ? 'ACTIVE' : 'DISABLED';
  if (!lobby.room) {
    return prisma.lobbyRoom.create({
      data: {
        lobbyId: lobby.id,
        roomKey: `lobby-${lobby.id}`,
        status: next,
      },
    });
  }
  if (lobby.room.status !== next) {
    return prisma.lobbyRoom.update({
      where: { id: lobby.room.id },
      data: { status: next },
    });
  }
  return lobby.room;
}

async function loadCall(callId: number) {
  const call = await prisma.lobbyCall.findUnique({
    where: { id: callId },
    include: callInclude,
  });
  if (!call) throw new RmoError('Call not found.', 404);
  return call;
}

function presentRecording(recording: CallRecord['recordings'][number]) {
  return {
    id: recording.id,
    lobbyCallId: recording.lobbyCallId,
    lobbyId: recording.lobbyId,
    startedById: recording.startedById,
    stoppedById: recording.stoppedById,
    startedAt: recording.startedAt,
    stoppedAt: recording.stoppedAt,
    duration: recording.duration,
    status: recording.status,
    fileSize: recording.fileSize,
    failureReason: recording.failureReason,
    canDownload: recording.status === 'COMPLETED' && Boolean(recording.storageKey),
  };
}

function presentCall(call: CallRecord) {
  const joined = call.participants.filter(item => item.status === 'JOINED');
  const active = call.recordings.find(item => item.status === 'RECORDING') || null;
  return {
    id: call.id,
    roomId: call.roomId,
    roomKey: call.room.roomKey,
    lobbyId: call.lobbyId,
    lobbyName: call.lobby.name,
    divisionId: call.divisionId,
    divisionName: call.lobby.division.name,
    zoneName: call.lobby.division.zone.name,
    monitorUserId: call.monitorUserId,
    monitorName: call.monitor.name,
    status: call.status,
    connection: call.connection,
    uiState: callUiState(call.status, call.connection),
    startedAt: call.startedAt,
    acceptedAt: call.acceptedAt,
    endedAt: call.endedAt,
    endedBy: call.endedBy?.name || null,
    endReason: call.endReason,
    participantCount: joined.length,
    participants: call.participants.map(item => ({
      id: item.id,
      userId: item.userId,
      name: item.user?.name || 'Participant',
      participantType: item.participantType,
      status: item.status,
      joinedAt: item.joinedAt,
      leftAt: item.leftAt,
    })),
    recording: {
      state: active ? 'RECORDING' : recordingState(call.recordings),
      activeId: active?.id || null,
    },
    recordings: call.recordings.map(presentRecording),
  };
}

function lobbyWhere(
  actor: Actor,
  query: { zoneId?: number; divisionId?: number; lobbyId?: number },
): Prisma.LobbyWhereInput {
  if (actor.rmoRole === 'SUPER_ADMIN') deny();
  if (actor.rmoRole === 'LOBBY_USER' || actor.rmoRole === 'CREW_USER') {
    if (!actor.homeLobbyId) deny();
    return { id: actor.homeLobbyId };
  }
  if (actor.rmoRole === 'DIVISION_ADMIN' || actor.rmoRole === 'DIVISION_MONITOR') {
    if (!actor.homeDivisionId) deny();
    return {
      divisionId: actor.homeDivisionId,
      ...(query.lobbyId ? { id: query.lobbyId } : {}),
    };
  }
  if (actor.rmoRole === 'SYSTEM_ADMIN') {
    return {
      ...(query.lobbyId ? { id: query.lobbyId } : {}),
      ...(query.divisionId ? { divisionId: query.divisionId } : {}),
      ...(query.zoneId ? { division: { zoneId: query.zoneId } } : {}),
    };
  }
  deny();
}

export async function listMonitoringLobbies(
  actor: Actor,
  query: { zoneId?: number; divisionId?: number; lobbyId?: number } = {},
) {
  const where = lobbyWhere(actor, query);
  const lobbies = await prisma.lobby.findMany({
    where,
    include: { division: { include: { zone: true } }, room: true },
    orderBy: { name: 'asc' },
  });
  for (const lobby of lobbies) {
    lobby.room = await ensureRoom(lobby);
  }
  const calls = lobbies.length
    ? await prisma.lobbyCall.findMany({
      where: { lobbyId: { in: lobbies.map(item => item.id) }, status: { in: OPEN_CALL } },
      include: callInclude,
    })
    : [];
  const byLobby = new Map(calls.map(call => [call.lobbyId, call]));
  const items = lobbies.map(lobby => {
    const call = byLobby.get(lobby.id);
    const presented = call ? presentCall(call) : null;
    return {
      id: lobby.id,
      name: lobby.name,
      code: lobby.code,
      status: lobby.status,
      divisionId: lobby.divisionId,
      divisionName: lobby.division.name,
      zoneId: lobby.division.zoneId,
      zoneName: lobby.division.zone.name,
      presence: lobby.room ? presenceOf(lobby.room.presence, lobby.room.lastSeenAt) : 'OFFLINE',
      room: lobby.room
        ? { id: lobby.room.id, roomKey: lobby.room.roomKey, status: lobby.room.status }
        : null,
      call: presented
        ? {
          id: presented.id,
          status: presented.status,
          connection: presented.connection,
          uiState: presented.uiState,
          monitorUserId: presented.monitorUserId,
          monitorName: presented.monitorName,
          acceptedAt: presented.acceptedAt,
          participantCount: presented.participantCount,
          recording: presented.recording,
        }
        : null,
    };
  });
  const connected = items.filter(item => item.call?.status === 'CONNECTED');
  return {
    items,
    summary: {
      lobbies: items.length,
      activeCalls: items.filter(item => item.call && OPEN_CALL.includes(item.call.status)).length,
      recordingNow: connected.filter(item => item.call?.recording.state === 'RECORDING').length,
      participants: connected.reduce((sum, item) => sum + (item.call?.participantCount || 0), 0),
    },
  };
}

export async function getMonitoringLobby(actor: Actor, lobbyId: number) {
  const lobby = await loadLobby(lobbyId);
  assertReadableLobby(actor, lobby);
  await ensureRoom(lobby);
  const page = await listMonitoringLobbies(actor, { lobbyId });
  const item = page.items.find(entry => entry.id === lobbyId);
  if (!item) throw new RmoError('Lobby not found.', 404);
  return item;
}

export async function beatLobbyPresence(
  actor: Actor,
  presence: LobbyPresence = 'ONLINE',
) {
  if (actor.rmoRole !== 'LOBBY_USER' || !actor.homeLobbyId) deny();
  const lobby = await loadLobby(actor.homeLobbyId);
  assertReadableLobby(actor, lobby);
  const room = await ensureRoom(lobby);
  if (room.status !== 'ACTIVE') {
    throw new RmoError('This lobby is not accepting calls.', 403);
  }
  await prisma.lobbyRoom.update({
    where: { id: room.id },
    data: { presence, lastSeenAt: new Date() },
  });
  return getMonitoringLobby(actor, lobby.id);
}

export async function callLobby(actor: Actor, lobbyId: number) {
  if (actor.rmoRole !== 'DIVISION_MONITOR') deny('Only a division monitor can call a lobby.');
  const lobby = await loadLobby(lobbyId);
  if (actor.homeDivisionId !== lobby.divisionId) deny();
  const room = await ensureRoom(lobby);
  if (lobby.status !== 'ACTIVE' || room.status !== 'ACTIVE') {
    throw new RmoError('This lobby is not accepting calls.', 403);
  }
  const open = await prisma.lobbyCall.findFirst({
    where: { lobbyId, status: { in: OPEN_CALL } },
  });
  if (open) {
    if (open.monitorUserId === actor.id) return presentCall(await loadCall(open.id));
    throw new RmoError('A call is already open for this lobby.', 409);
  }
  const created = await prisma.lobbyCall.create({
    data: {
      roomId: room.id,
      lobbyId: lobby.id,
      divisionId: lobby.divisionId,
      monitorUserId: actor.id,
      status: 'RINGING',
      connection: 'IDLE',
      participants: {
        create: {
          roomId: room.id,
          userId: actor.id,
          participantType: 'DIVISION_MONITOR',
          status: 'JOINED',
        },
      },
    },
  });
  const metadata = { lobbyId: lobby.id, divisionId: lobby.divisionId, callId: created.id };
  await audit(actor.id, 'lobby.call.created', created.id, metadata);
  await audit(actor.id, 'participant.joined', created.id, {
    ...metadata,
    participantType: 'DIVISION_MONITOR',
  });
  emit('lobby.call.incoming', created);
  emit('participant.joined', created);
  return presentCall(await loadCall(created.id));
}

async function requireLobbyUserCall(actor: Actor, callId: number) {
  if (actor.rmoRole !== 'LOBBY_USER') deny('Only the lobby user can answer this call.');
  const call = await loadCall(callId);
  if (actor.homeLobbyId !== call.lobbyId) deny('Only the lobby user can answer this call.');
  return call;
}

export async function acceptCall(actor: Actor, callId: number) {
  const call = await requireLobbyUserCall(actor, callId);
  if (call.status !== 'RINGING') {
    throw new RmoError('This call is no longer ringing.', 409);
  }
  if (call.room.status !== 'ACTIVE') {
    throw new RmoError('This lobby is not accepting calls.', 403);
  }
  await prisma.$transaction([
    prisma.lobbyCall.update({
      where: { id: call.id },
      data: { status: 'CONNECTED', connection: 'CONNECTED', acceptedAt: new Date() },
    }),
    prisma.roomParticipant.create({
      data: {
        roomId: call.roomId,
        callId: call.id,
        userId: actor.id,
        participantType: 'LOBBY_USER',
        status: 'JOINED',
      },
    }),
  ]);
  const metadata = { lobbyId: call.lobbyId, divisionId: call.divisionId, callId: call.id };
  await audit(actor.id, 'lobby.call.accepted', call.id, metadata);
  await audit(actor.id, 'participant.joined', call.id, {
    ...metadata,
    participantType: 'LOBBY_USER',
  });
  emit('lobby.call.accepted', call);
  emit('lobby.call.connected', call);
  emit('participant.joined', call);
  return presentCall(await loadCall(call.id));
}

export async function rejectCall(actor: Actor, callId: number) {
  const call = await requireLobbyUserCall(actor, callId);
  if (call.status !== 'RINGING') {
    throw new RmoError('This call is no longer ringing.', 409);
  }
  await prisma.lobbyCall.update({
    where: { id: call.id },
    data: {
      status: 'CANCELLED',
      connection: 'DISCONNECTED',
      endedAt: new Date(),
      endedById: actor.id,
      endReason: 'rejected',
    },
  });
  await audit(actor.id, 'lobby.call.rejected', call.id, {
    lobbyId: call.lobbyId,
    divisionId: call.divisionId,
    callId: call.id,
  });
  clearCallSignals(call.id);
  emit('lobby.call.rejected', call);
  return presentCall(await loadCall(call.id));
}

export async function endCall(actor: Actor, callId: number, reason?: string) {
  const call = await loadCall(callId);
  const monitorOwns = actor.rmoRole === 'DIVISION_MONITOR'
    && actor.id === call.monitorUserId
    && actor.homeDivisionId === call.divisionId;
  const lobbyOwns = actor.rmoRole === 'LOBBY_USER' && actor.homeLobbyId === call.lobbyId;
  if (!monitorOwns && !lobbyOwns) deny('You cannot end this call.');
  if (call.status !== 'RINGING' && call.status !== 'CONNECTED') {
    throw new RmoError('This call has already ended.', 409);
  }
  const cancelling = call.status === 'RINGING';
  const next: LobbyCallStatus = cancelling ? 'CANCELLED' : 'ENDED';
  await prisma.$transaction([
    prisma.lobbyCall.update({
      where: { id: call.id },
      data: {
        status: next,
        connection: 'DISCONNECTED',
        endedAt: new Date(),
        endedById: actor.id,
        endReason: (reason || (cancelling ? 'cancelled' : 'ended')).slice(0, 200),
      },
    }),
    prisma.roomParticipant.updateMany({
      where: { callId: call.id, status: 'JOINED' },
      data: { status: 'LEFT', leftAt: new Date() },
    }),
  ]);
  await audit(actor.id, 'lobby.call.ended', call.id, {
    lobbyId: call.lobbyId,
    divisionId: call.divisionId,
    callId: call.id,
    status: next,
  });
  clearCallSignals(call.id);
  emit('lobby.call.ended', call);
  return presentCall(await loadCall(call.id));
}

export async function getCall(actor: Actor, callId: number) {
  const call = await loadCall(callId);
  assertReadableLobby(actor, { id: call.lobbyId, divisionId: call.divisionId });
  return presentCall(call);
}

export async function setCallConnection(
  actor: Actor,
  callId: number,
  state: 'RECONNECTING' | 'CONNECTED' | 'FAILED',
  unrecoverable = false,
) {
  const call = await loadCall(callId);
  assertReadableLobby(actor, { id: call.lobbyId, divisionId: call.divisionId });
  const joined = call.participants.some(item => item.userId === actor.id && item.status === 'JOINED');
  if (!joined) deny('You are not a participant on this call.');
  if (call.status !== 'CONNECTED') {
    throw new RmoError('Only a connected call can change connection state.', 409);
  }
  if (state === 'FAILED') {
    if (!unrecoverable) {
      throw new RmoError('A temporary disconnect does not end the call.', 409);
    }
    await prisma.lobbyCall.update({
      where: { id: call.id },
      data: {
        status: 'FAILED',
        connection: 'DISCONNECTED',
        endedAt: new Date(),
        endedById: actor.id,
        endReason: 'unrecoverable',
      },
    });
    emit('connection.failed', call);
    return presentCall(await loadCall(call.id));
  }
  await prisma.lobbyCall.update({
    where: { id: call.id },
    data: { connection: state, status: 'CONNECTED' },
  });
  emit(state === 'RECONNECTING' ? 'connection.reconnecting' : 'connection.reconnected', call);
  return presentCall(await loadCall(call.id));
}

export async function mediaToken(actor: Actor, callId: number) {
  const call = await getCall(actor, callId);
  if (call.status !== 'CONNECTED') {
    throw new RmoError('Media is available after the lobby accepts the call.', 409);
  }
  const joined = call.participants.some(item => item.userId === actor.id && item.status === 'JOINED');
  if (!joined) deny('You are not a participant on this call.');
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { name: true },
  });
  const token = await mintLiveKitToken({
    identity: `user-${actor.id}`,
    name: user?.name || 'Participant',
    roomKey: call.roomKey,
  });
  return {
    callId: call.id,
    roomKey: call.roomKey,
    configured: Boolean(token),
    url: token?.url || null,
    token: token?.token || null,
  };
}

async function requireJoinedCall(actor: Actor, callId: number) {
  const call = await loadCall(callId);
  assertReadableLobby(actor, { id: call.lobbyId, divisionId: call.divisionId });
  if (call.status !== 'CONNECTED') {
    throw new RmoError('Media is available after the lobby accepts the call.', 409);
  }
  const joined = call.participants.some(item => item.userId === actor.id && item.status === 'JOINED');
  if (!joined) deny('You are not a participant on this call.');
  return call;
}

export async function postCallSignal(actor: Actor, callId: number, body: unknown) {
  const call = await requireJoinedCall(actor, callId);
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const type = input.type;
  if (type !== 'offer' && type !== 'answer' && type !== 'ice') {
    throw new RmoError('Signal type must be offer, answer, or ice.', 400);
  }
  if (type === 'offer' && actor.rmoRole !== 'DIVISION_MONITOR') {
    deny('Only the division monitor starts the video offer.');
  }
  if (type === 'answer' && actor.rmoRole !== 'LOBBY_USER') {
    deny('Only the lobby answers the video offer.');
  }
  let description: { type: string; sdp: string } | null = null;
  let candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } | null = null;
  if (type === 'offer' || type === 'answer') {
    const raw = input.description;
    if (!raw || typeof raw !== 'object') throw new RmoError('A session description is required.', 400);
    const record = raw as Record<string, unknown>;
    if (typeof record.sdp !== 'string' || record.sdp.length === 0 || record.sdp.length > 100_000) {
      throw new RmoError('The session description is not valid.', 400);
    }
    description = { type: typeof record.type === 'string' ? record.type : type, sdp: record.sdp };
  } else {
    const raw = input.candidate;
    if (!raw || typeof raw !== 'object') throw new RmoError('An ICE candidate is required.', 400);
    const record = raw as Record<string, unknown>;
    if (typeof record.candidate !== 'string' || record.candidate.length > 4000) {
      throw new RmoError('The ICE candidate is not valid.', 400);
    }
    candidate = {
      candidate: record.candidate,
      sdpMid: typeof record.sdpMid === 'string' ? record.sdpMid : null,
      sdpMLineIndex: typeof record.sdpMLineIndex === 'number' ? record.sdpMLineIndex : null,
    };
  }
  const signal = appendCallSignal({
    callId: call.id,
    fromUserId: actor.id,
    type,
    description,
    candidate,
  });
  emit('webrtc.signal', call);
  return { seq: signal.seq };
}

export async function listCallSignals(actor: Actor, callId: number, after: number) {
  const call = await requireJoinedCall(actor, callId);
  return {
    callId: call.id,
    signals: readCallSignals(call.id, after),
  };
}

export async function listParticipants(actor: Actor, callId: number) {
  const call = await getCall(actor, callId);
  return call.participants;
}

export async function joinCall(actor: Actor, callId: number) {
  if (actor.rmoRole !== 'CREW_USER') deny('Only a crew member can join this way.');
  const call = await loadCall(callId);
  if (actor.homeLobbyId !== call.lobbyId) deny('You can only join your own lobby.');
  if (call.status !== 'CONNECTED') {
    throw new RmoError('The lobby call is not connected.', 409);
  }
  const existing = call.participants.find(
    item => item.userId === actor.id && item.status === 'JOINED',
  );
  if (existing) return presentCall(call);
  const enrollment = await prisma.crewEnrollment.findFirst({
    where: { createdUserId: actor.id, status: 'APPROVED' },
    select: { id: true },
  });
  await prisma.roomParticipant.create({
    data: {
      roomId: call.roomId,
      callId: call.id,
      userId: actor.id,
      crewEnrollmentId: enrollment?.id,
      participantType: 'CREW_MEMBER',
      status: 'JOINED',
    },
  });
  await audit(actor.id, 'participant.joined', call.id, {
    lobbyId: call.lobbyId,
    divisionId: call.divisionId,
    callId: call.id,
    participantType: 'CREW_MEMBER',
  });
  emit('participant.joined', call);
  return presentCall(await loadCall(call.id));
}

export async function leaveCall(actor: Actor, callId: number, participantId: number) {
  const call = await loadCall(callId);
  const participant = call.participants.find(item => item.id === participantId);
  if (!participant || participant.status !== 'JOINED') {
    throw new RmoError('Participant not found.', 404);
  }
  const self = participant.userId === actor.id;
  const crewLeaving = actor.rmoRole === 'CREW_USER' && self && participant.participantType === 'CREW_MEMBER';
  if (!crewLeaving) deny('You cannot remove this participant.');
  if (actor.homeLobbyId !== call.lobbyId) deny();
  await prisma.roomParticipant.update({
    where: { id: participant.id },
    data: { status: 'LEFT', leftAt: new Date() },
  });
  await audit(actor.id, 'participant.left', call.id, {
    lobbyId: call.lobbyId,
    divisionId: call.divisionId,
    callId: call.id,
    participantId: participant.id,
  });
  emit('participant.left', call);
  const next = await loadCall(call.id);
  if (next.status !== 'CONNECTED') {
    throw new RmoError('Leaving the room ended the call.', 500);
  }
  return presentCall(next);
}

function assertMonitorCanRecord(actor: Actor, call: CallRecord) {
  if (actor.rmoRole !== 'DIVISION_MONITOR' || actor.homeDivisionId !== call.divisionId) {
    deny('Only the division monitor can control recording.');
  }
  if (call.status !== 'CONNECTED') {
    throw new RmoError('Recording requires a connected call.', 409);
  }
}

export async function startRecording(actor: Actor, callId: number) {
  const call = await loadCall(callId);
  assertMonitorCanRecord(actor, call);
  if (call.recordings.some(item => item.status === 'RECORDING')) {
    throw new RmoError('A recording is already in progress.', 409);
  }
  const forcedFailure = process.env.RMO_RECORDING_FAIL === '1';
  const created = await prisma.recordingSegment.create({
    data: {
      lobbyCallId: call.id,
      roomId: call.roomId,
      lobbyId: call.lobbyId,
      startedById: actor.id,
      status: forcedFailure ? 'FAILED' : 'RECORDING',
      failureReason: forcedFailure ? 'Recording could not be started.' : null,
    },
  });
  if (forcedFailure) {
    await audit(actor.id, 'recording.failed', call.id, {
      lobbyId: call.lobbyId,
      divisionId: call.divisionId,
      callId: call.id,
      recordingId: created.id,
    });
    emit('recording.failed', call, created.id);
    const current = await loadCall(call.id);
    if (current.status !== 'CONNECTED') {
      throw new RmoError('Recording failure ended the call.', 500);
    }
    return {
      message: 'Recording could not be started.',
      call: presentCall(current),
    };
  }
  try {
    const file = await writeRecordingArtifact({
      id: created.id,
      lobbyCallId: call.id,
      lobbyId: call.lobbyId,
      roomKey: call.room.roomKey,
      startedAt: created.startedAt.toISOString(),
      status: 'RECORDING',
      startedById: actor.id,
    });
    await prisma.recordingSegment.update({
      where: { id: created.id },
      data: { storageKey: file.storageKey, fileSize: file.fileSize },
    });
  } catch (error) {
    await prisma.recordingSegment.update({
      where: { id: created.id },
      data: {
        status: 'FAILED',
        storageKey: null,
        failureReason: 'Recording could not be started.',
      },
    });
    await audit(actor.id, 'recording.failed', call.id, {
      lobbyId: call.lobbyId,
      divisionId: call.divisionId,
      callId: call.id,
      recordingId: created.id,
    });
    emit('recording.failed', call, created.id);
    void error;
    const current = await loadCall(call.id);
    return {
      message: 'Recording could not be started.',
      call: presentCall(current),
    };
  }
  await audit(actor.id, 'recording.started', call.id, {
    lobbyId: call.lobbyId,
    divisionId: call.divisionId,
    callId: call.id,
    recordingId: created.id,
  });
  emit('recording.started', call, created.id);
  return { message: null, call: presentCall(await loadCall(call.id)) };
}

export async function stopRecording(actor: Actor, callId: number, recordingId: number) {
  const call = await loadCall(callId);
  assertMonitorCanRecord(actor, call);
  const recording = call.recordings.find(item => item.id === recordingId);
  if (!recording || recording.status !== 'RECORDING') {
    throw new RmoError('Recording not found.', 404);
  }
  const stoppedAt = new Date();
  const duration = Math.max(0, Math.round((stoppedAt.getTime() - recording.startedAt.getTime()) / 1000));
  let fileSize = recording.fileSize;
  let storageKey = recording.storageKey;
  if (isPlayableRecording(storageKey)) {
    fileSize = recording.fileSize;
  } else {
    try {
      const file = await writeRecordingArtifact({
        id: recording.id,
        lobbyCallId: call.id,
        lobbyId: call.lobbyId,
        roomKey: call.room.roomKey,
        startedAt: recording.startedAt.toISOString(),
        stoppedAt: stoppedAt.toISOString(),
        status: 'COMPLETED',
        startedById: recording.startedById,
        stoppedById: actor.id,
      });
      fileSize = file.fileSize;
      storageKey = file.storageKey;
    } catch (error) {
      void error;
      storageKey = storageKey || recordingStorageKey(recording.id);
    }
  }
  await prisma.recordingSegment.update({
    where: { id: recording.id },
    data: {
      status: 'COMPLETED',
      stoppedAt,
      stoppedById: actor.id,
      duration,
      fileSize,
      storageKey,
    },
  });
  await audit(actor.id, 'recording.stopped', call.id, {
    lobbyId: call.lobbyId,
    divisionId: call.divisionId,
    callId: call.id,
    recordingId: recording.id,
  });
  emit('recording.stopped', call, recording.id);
  const current = await loadCall(call.id);
  if (current.status !== 'CONNECTED') {
    throw new RmoError('Stopping the recording ended the call.', 500);
  }
  return presentCall(current);
}

const MAX_RECORDING_BYTES = 200 * 1024 * 1024;

function mediaExtension(bytes: Buffer) {
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('hex') === '1a45dfa3') return 'webm' as const;
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4' as const;
  return null;
}

export async function saveRecordingMedia(
  actor: Actor,
  callId: number,
  recordingId: number,
  bytes: Buffer,
) {
  const call = await loadCall(callId);
  assertMonitorCanRecord(actor, call);
  const recording = call.recordings.find(item => item.id === recordingId);
  if (!recording || recording.status !== 'RECORDING') {
    throw new RmoError('Recording not found.', 404);
  }
  if (bytes.length > MAX_RECORDING_BYTES) {
    throw new RmoError('Recording file is too large.', 413);
  }
  const extension = mediaExtension(bytes);
  if (!extension || bytes.length < 32) {
    throw new RmoError('Recording file is not a video.', 400);
  }
  let saved: { storageKey: string; fileSize: number };
  try {
    saved = await writeRecordingMedia(recording.id, bytes, extension);
  } catch (error) {
    void error;
    throw new RmoError('Recording could not be saved.', 500);
  }
  await prisma.recordingSegment.update({
    where: { id: recording.id },
    data: { storageKey: saved.storageKey, fileSize: saved.fileSize },
  });
  const current = await loadCall(call.id);
  if (current.status !== 'CONNECTED') {
    throw new RmoError('Saving the recording ended the call.', 500);
  }
  return { fileSize: saved.fileSize, call: presentCall(current) };
}

function historyWhere(actor: Actor, query: { zoneId?: number; divisionId?: number; lobbyId?: number }) {
  const lobby = lobbyWhere(actor, query);
  if (actor.rmoRole === 'LOBBY_USER' || actor.rmoRole === 'CREW_USER') {
    deny('You do not have access to call history.');
  }
  return lobby;
}

export async function listCallHistory(
  actor: Actor,
  query: { zoneId?: number; divisionId?: number; lobbyId?: number; page?: number; pageSize?: number },
) {
  const where = { lobby: historyWhere(actor, query) };
  const page = Math.max(query.page || 1, 1);
  const pageSize = Math.min(Math.max(query.pageSize || 20, 1), 50);
  const [total, rows] = await Promise.all([
    prisma.lobbyCall.count({ where }),
    prisma.lobbyCall.findMany({
      where,
      include: callInclude,
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    items: rows.map(call => {
      const presented = presentCall(call);
      const end = call.endedAt || (call.status === 'CONNECTED' ? new Date() : call.startedAt);
      const duration = Math.max(0, Math.round((end.getTime() - call.startedAt.getTime()) / 1000));
      return {
        id: presented.id,
        lobbyName: presented.lobbyName,
        divisionName: presented.divisionName,
        zoneName: presented.zoneName,
        monitorName: presented.monitorName,
        startedAt: presented.startedAt,
        endedAt: presented.endedAt,
        duration,
        participantCount: call.participants.length,
        recordingCount: call.recordings.length,
        status: call.status === 'ENDED' ? 'COMPLETED' : call.status,
      };
    }),
    total,
    page,
    pageSize,
  };
}

export async function listRecordings(
  actor: Actor,
  query: { zoneId?: number; divisionId?: number; lobbyId?: number; callId?: number },
) {
  const rows = await prisma.recordingSegment.findMany({
    where: {
      ...(query.callId ? { lobbyCallId: query.callId } : {}),
      lobby: historyWhere(actor, query),
    },
    include: {
      startedBy: { select: { name: true } },
      lobby: { select: { name: true, division: { select: { name: true } } } },
    },
    orderBy: { startedAt: 'desc' },
    take: 100,
  });
  return {
    items: rows.map(row => ({
      id: row.id,
      lobbyCallId: row.lobbyCallId,
      lobbyName: row.lobby.name,
      divisionName: row.lobby.division.name,
      startedAt: row.startedAt,
      stoppedAt: row.stoppedAt,
      duration: row.duration,
      startedBy: row.startedBy.name,
      status: row.status,
      fileSize: row.fileSize,
      canDownload: row.status === 'COMPLETED' && Boolean(row.storageKey),
      canPlay: row.status === 'COMPLETED' && isPlayableRecording(row.storageKey),
    })),
  };
}

export async function getRecording(actor: Actor, recordingId: number) {
  const row = await prisma.recordingSegment.findUnique({
    where: { id: recordingId },
    include: { lobby: { select: { id: true, divisionId: true, name: true } } },
  });
  if (!row) throw new RmoError('Recording not found.', 404);
  assertReadableLobby(actor, row.lobby);
  if (actor.rmoRole === 'LOBBY_USER' || actor.rmoRole === 'CREW_USER') {
    deny('You do not have access to recordings.');
  }
  const list = await listRecordings(actor, { lobbyId: row.lobbyId, callId: row.lobbyCallId });
  const item = list.items.find(entry => entry.id === recordingId);
  if (!item) throw new RmoError('Recording not found.', 404);
  return item;
}

export async function openRecordingFile(actor: Actor, recordingId: number) {
  const row = await prisma.recordingSegment.findUnique({
    where: { id: recordingId },
    include: { lobby: { select: { id: true, divisionId: true } } },
  });
  if (!row || !row.storageKey || row.status !== 'COMPLETED') {
    throw new RmoError('Recording file is not available.', 404);
  }
  assertReadableLobby(actor, row.lobby);
  if (!canReadDivision(actor, row.lobby.divisionId)) {
    deny('You do not have access to recordings.');
  }
  return readRecordingArtifact(row.storageKey);
}
