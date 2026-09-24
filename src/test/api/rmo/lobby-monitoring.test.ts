import { POST as acceptCall } from '@/app/api/monitoring/calls/[id]/accept/route';
import { POST as setConnection } from '@/app/api/monitoring/calls/[id]/connection/route';
import { POST as endCall } from '@/app/api/monitoring/calls/[id]/end/route';
import { POST as leaveParticipant } from '@/app/api/monitoring/calls/[id]/participants/[participantId]/leave/route';
import { POST as joinParticipant } from '@/app/api/monitoring/calls/[id]/participants/route';
import { POST as saveRecordingMedia } from '@/app/api/monitoring/calls/[id]/recording/[recordingId]/media/route';
import { POST as startRecording } from '@/app/api/monitoring/calls/[id]/recording/start/route';
import { POST as stopRecording } from '@/app/api/monitoring/calls/[id]/recording/[recordingId]/stop/route';
import { POST as rejectCall } from '@/app/api/monitoring/calls/[id]/reject/route';
import { GET as getCall } from '@/app/api/monitoring/calls/[id]/route';
import { GET as readSignals, POST as sendSignal } from '@/app/api/monitoring/calls/[id]/signal/route';
import { GET as history } from '@/app/api/monitoring/history/route';
import { POST as callLobby } from '@/app/api/monitoring/lobbies/[id]/call/route';
import { GET as listLobbies } from '@/app/api/monitoring/lobbies/route';
import { POST as presence } from '@/app/api/monitoring/presence/route';
import { GET as recordingFile } from '@/app/api/monitoring/recordings/[id]/file/route';
import { GET as recordings } from '@/app/api/monitoring/recordings/route';
import { prisma } from '@/lib/prisma';
import { toSessionClaims } from '@/lib/rmo/session-claims';
import { hashPassword } from '@/lib/utils';
import { NextRequest } from 'next/server';
import { cleanupDatabase } from '../../setup';

jest.mock('@/lib/auth/jwt', () => ({
  generateJWT: jest.fn(async () => 'test-token'),
  setAuthCookie: jest.fn(),
  JWT_KEY: 'auth-token',
  getAuthUser: jest.fn(async (request: { headers: { get: (name: string) => string | null } }) => {
    const raw = request.headers.get('x-test-user');
    return raw ? JSON.parse(raw) : null;
  }),
}));

type Role = 'SYSTEM_ADMIN' | 'SUPER_ADMIN' | 'DIVISION_ADMIN' | 'DIVISION_MONITOR' | 'LOBBY_USER' | 'CREW_USER';

async function userWith(input: {
  name: string;
  email: string;
  loginId: string;
  rmoRole: Role;
  homeZoneId?: number;
  homeDivisionId?: number;
  homeLobbyId?: number;
}) {
  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      loginId: input.loginId,
      password: await hashPassword('TestPassword123!'),
      role: 'USER',
      rmoRole: input.rmoRole,
      accountStatus: 'ACTIVE',
      isOnboarded: true,
      homeZoneId: input.homeZoneId,
      homeDivisionId: input.homeDivisionId,
      homeLobbyId: input.homeLobbyId,
    },
  });
}

function requestFor(
  user: Parameters<typeof toSessionClaims>[0] | null,
  path: string,
  method: string,
  body?: unknown,
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (user) headers.set('x-test-user', JSON.stringify(toSessionClaims(user)));
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function context<T extends Record<string, string>>(id: number, extra?: T) {
  return {
    params: Promise.resolve({ id: String(id), ...(extra || {}) } as { id: string } & T),
  };
}

async function jsonOf(response: Response) {
  return response.json();
}

describe('24x7 lobby monitoring', () => {
  let sequence = 0;
  let org: {
    system: Awaited<ReturnType<typeof userWith>>;
    superAdmin: Awaited<ReturnType<typeof userWith>>;
    ahmedabadMonitor: Awaited<ReturnType<typeof userWith>>;
    suratMonitor: Awaited<ReturnType<typeof userWith>>;
    divisionAdmin: Awaited<ReturnType<typeof userWith>>;
    lobbyUser: Awaited<ReturnType<typeof userWith>>;
    otherLobbyUser: Awaited<ReturnType<typeof userWith>>;
    crewA: Awaited<ReturnType<typeof userWith>>;
    crewB: Awaited<ReturnType<typeof userWith>>;
    suratCrew: Awaited<ReturnType<typeof userWith>>;
    zone: { id: number };
    ahmedabad: { id: number };
    surat: { id: number };
    vatva: { id: number };
    disabledLobby: { id: number };
    suratLobby: { id: number };
  };

  beforeEach(async () => {
    await cleanupDatabase();
    delete process.env.RMO_RECORDING_FAIL;
    sequence += 1;
    const zone = await prisma.zone.create({ data: { name: 'West', code: `W${sequence}` } });
    const ahmedabad = await prisma.division.create({
      data: { zoneId: zone.id, name: 'Ahmedabad', code: `A${sequence}` },
    });
    const surat = await prisma.division.create({
      data: { zoneId: zone.id, name: 'Surat', code: `S${sequence}` },
    });
    const vatva = await prisma.lobby.create({
      data: { divisionId: ahmedabad.id, name: 'Vatva', code: `V${sequence}` },
    });
    const disabledLobby = await prisma.lobby.create({
      data: { divisionId: ahmedabad.id, name: 'Closed', code: `C${sequence}`, status: 'DISABLED' },
    });
    const suratLobby = await prisma.lobby.create({
      data: { divisionId: surat.id, name: 'Udhna', code: `U${sequence}` },
    });
    const home = { homeZoneId: zone.id, homeDivisionId: ahmedabad.id };
    org = {
      zone,
      ahmedabad,
      surat,
      vatva,
      disabledLobby,
      suratLobby,
      system: await userWith({ name: 'System', email: `sys-${sequence}@local`, loginId: `sys-${sequence}`, rmoRole: 'SYSTEM_ADMIN' }),
      superAdmin: await userWith({ name: 'Super', email: `super-${sequence}@local`, loginId: `super-${sequence}`, rmoRole: 'SUPER_ADMIN' }),
      divisionAdmin: await userWith({ name: 'Admin', email: `admin-${sequence}@local`, loginId: `admin-${sequence}`, rmoRole: 'DIVISION_ADMIN', ...home }),
      ahmedabadMonitor: await userWith({ name: 'Raj Patel', email: `mon-a-${sequence}@local`, loginId: `mon-a-${sequence}`, rmoRole: 'DIVISION_MONITOR', ...home, homeLobbyId: vatva.id }),
      suratMonitor: await userWith({ name: 'Surat Monitor', email: `mon-s-${sequence}@local`, loginId: `mon-s-${sequence}`, rmoRole: 'DIVISION_MONITOR', homeZoneId: zone.id, homeDivisionId: surat.id, homeLobbyId: suratLobby.id }),
      lobbyUser: await userWith({ name: 'Lobby Operator', email: `lobby-${sequence}@local`, loginId: `lobby-${sequence}`, rmoRole: 'LOBBY_USER', ...home, homeLobbyId: vatva.id }),
      otherLobbyUser: await userWith({ name: 'Other Lobby', email: `other-${sequence}@local`, loginId: `other-${sequence}`, rmoRole: 'LOBBY_USER', homeZoneId: zone.id, homeDivisionId: surat.id, homeLobbyId: suratLobby.id }),
      crewA: await userWith({ name: 'Crew A', email: `crew-a-${sequence}@local`, loginId: `crew-a-${sequence}`, rmoRole: 'CREW_USER', ...home, homeLobbyId: vatva.id }),
      crewB: await userWith({ name: 'Crew B', email: `crew-b-${sequence}@local`, loginId: `crew-b-${sequence}`, rmoRole: 'CREW_USER', ...home, homeLobbyId: vatva.id }),
      suratCrew: await userWith({ name: 'Surat Crew', email: `crew-s-${sequence}@local`, loginId: `crew-s-${sequence}`, rmoRole: 'CREW_USER', homeZoneId: zone.id, homeDivisionId: surat.id, homeLobbyId: suratLobby.id }),
    };
  });

  afterEach(() => {
    delete process.env.RMO_RECORDING_FAIL;
  });

  async function openConnectedCall() {
    const ringing = await jsonOf(await callLobby(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/lobbies/${org.vatva.id}/call`, 'POST'),
      context(org.vatva.id),
    ));
    expect(ringing.success).toBe(true);
    const connected = await jsonOf(await acceptCall(
      requestFor(org.lobbyUser, `/api/monitoring/calls/${ringing.data.id}/accept`, 'POST'),
      context(ringing.data.id),
    ));
    expect(connected.data.status).toBe('CONNECTED');
    return connected.data as {
      id: number;
      status: string;
      participants: { id: number; participantType: string; status: string }[];
      recordings: { id: number; status: string }[];
      recording: { state: string; activeId: number | null };
    };
  }

  it('creates one persistent room and refuses a disabled lobby', async () => {
    const page = await jsonOf(await listLobbies(requestFor(org.ahmedabadMonitor, '/api/monitoring/lobbies', 'GET')));
    const vatva = page.data.items.find((item: { id: number }) => item.id === org.vatva.id);
    expect(vatva.room.roomKey).toBe(`lobby-${org.vatva.id}`);
    expect(vatva.room.status).toBe('ACTIVE');
    expect(vatva.call).toBeNull();
    const rooms = await prisma.lobbyRoom.count({ where: { lobbyId: org.vatva.id } });
    expect(rooms).toBe(1);

    const denied = await callLobby(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/lobbies/${org.disabledLobby.id}/call`, 'POST'),
      context(org.disabledLobby.id),
    );
    expect(denied.status).toBe(403);
  });

  it('lets a monitor call and a lobby user accept, reject, or end', async () => {
    const cross = await callLobby(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/lobbies/${org.suratLobby.id}/call`, 'POST'),
      context(org.suratLobby.id),
    );
    expect(cross.status).toBe(403);

    const ringing = await jsonOf(await callLobby(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/lobbies/${org.vatva.id}/call`, 'POST'),
      context(org.vatva.id),
    ));
    expect(ringing.data.status).toBe('RINGING');
    expect(ringing.data.uiState).toBe('RINGING');

    const rejected = await jsonOf(await rejectCall(
      requestFor(org.lobbyUser, `/api/monitoring/calls/${ringing.data.id}/reject`, 'POST'),
      context(ringing.data.id),
    ));
    expect(rejected.data.status).toBe('CANCELLED');

    const again = await jsonOf(await callLobby(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/lobbies/${org.vatva.id}/call`, 'POST'),
      context(org.vatva.id),
    ));
    const connected = await openFrom(again.data.id);
    expect(connected.status).toBe('CONNECTED');

    const endedByLobby = await jsonOf(await endCall(
      requestFor(org.lobbyUser, `/api/monitoring/calls/${connected.id}/end`, 'POST'),
      context(connected.id),
    ));
    expect(endedByLobby.data.status).toBe('ENDED');
    expect(endedByLobby.data.uiState).toBe('ENDED');
  });

  async function openFrom(callId: number) {
    const connected = await jsonOf(await acceptCall(
      requestFor(org.lobbyUser, `/api/monitoring/calls/${callId}/accept`, 'POST'),
      context(callId),
    ));
    return connected.data;
  }

  it('keeps the call connected while crew join, leave, and recording starts and stops', async () => {
    const call = await openConnectedCall();
    const first = await jsonOf(await joinParticipant(
      requestFor(org.crewA, `/api/monitoring/calls/${call.id}/participants`, 'POST'),
      context(call.id),
    ));
    const second = await jsonOf(await joinParticipant(
      requestFor(org.crewB, `/api/monitoring/calls/${call.id}/participants`, 'POST'),
      context(call.id),
    ));
    expect(second.data.status).toBe('CONNECTED');
    expect(second.data.participants.filter((item: { status: string }) => item.status === 'JOINED')).toHaveLength(4);

    const outsider = await joinParticipant(
      requestFor(org.suratCrew, `/api/monitoring/calls/${call.id}/participants`, 'POST'),
      context(call.id),
    );
    expect(outsider.status).toBe(403);

    const crewRow = first.data.participants.find((item: { participantType: string; status: string }) => (
      item.participantType === 'CREW_MEMBER' && item.status === 'JOINED'
    ));
    const left = await jsonOf(await leaveParticipant(
      requestFor(org.crewA, `/api/monitoring/calls/${call.id}/participants/${crewRow.id}/leave`, 'POST'),
      context(call.id, { participantId: String(crewRow.id) }),
    ));
    expect(left.data.status).toBe('CONNECTED');

    const started = await jsonOf(await startRecording(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/calls/${call.id}/recording/start`, 'POST'),
      context(call.id),
    ));
    expect(started.data.call.status).toBe('CONNECTED');
    expect(started.data.call.recording.state).toBe('RECORDING');
    const recordingId = started.data.call.recording.activeId as number;
    expect(JSON.stringify(started)).not.toMatch(/storageKey|password|token/);

    const stopped = await jsonOf(await stopRecording(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/calls/${call.id}/recording/${recordingId}/stop`, 'POST'),
      context(call.id, { recordingId: String(recordingId) }),
    ));
    expect(stopped.data.status).toBe('CONNECTED');
    expect(stopped.data.recording.state).not.toBe('RECORDING');

    const again = await jsonOf(await startRecording(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/calls/${call.id}/recording/start`, 'POST'),
      context(call.id),
    ));
    const secondId = again.data.call.recording.activeId as number;
    await stopRecording(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/calls/${call.id}/recording/${secondId}/stop`, 'POST'),
      context(call.id, { recordingId: String(secondId) }),
    );
    const current = await jsonOf(await getCall(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/calls/${call.id}`, 'GET'),
      context(call.id),
    ));
    expect(current.data.status).toBe('CONNECTED');
    expect(current.data.recordings).toHaveLength(2);
    expect(current.data.recordings.every((item: { status: string }) => item.status === 'COMPLETED')).toBe(true);

    const lobbyRecord = await startRecording(
      requestFor(org.lobbyUser, `/api/monitoring/calls/${call.id}/recording/start`, 'POST'),
      context(call.id),
    );
    expect(lobbyRecord.status).toBe(403);
  });

  it('does not end the call when recording fails or the monitor reconnects', async () => {
    const call = await openConnectedCall();
    process.env.RMO_RECORDING_FAIL = '1';
    const failed = await jsonOf(await startRecording(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/calls/${call.id}/recording/start`, 'POST'),
      context(call.id),
    ));
    expect(failed.data.message).toBe('Recording could not be started.');
    expect(failed.data.call.status).toBe('CONNECTED');
    expect(failed.data.call.recordings.at(-1).status).toBe('FAILED');
    delete process.env.RMO_RECORDING_FAIL;

    const before = await prisma.lobbyCall.count();
    const reconnecting = await jsonOf(await setConnection(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/calls/${call.id}/connection`, 'POST', { state: 'RECONNECTING' }),
      context(call.id),
    ));
    expect(reconnecting.data.status).toBe('CONNECTED');
    expect(reconnecting.data.uiState).toBe('RECONNECTING');
    const restored = await jsonOf(await setConnection(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/calls/${call.id}/connection`, 'POST', { state: 'CONNECTED' }),
      context(call.id),
    ));
    expect(restored.data.status).toBe('CONNECTED');
    expect(restored.data.uiState).toBe('CONNECTED');
    const duplicate = await jsonOf(await callLobby(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/lobbies/${org.vatva.id}/call`, 'POST'),
      context(org.vatva.id),
    ));
    expect(duplicate.data.id).toBe(call.id);
    expect(await prisma.lobbyCall.count()).toBe(before);

    const temporary = await setConnection(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/calls/${call.id}/connection`, 'POST', { state: 'FAILED' }),
      context(call.id),
    );
    expect(temporary.status).toBe(409);
    const still = await prisma.lobbyCall.findUnique({ where: { id: call.id } });
    expect(still?.status).toBe('CONNECTED');
  });

  it('keeps division boundaries on reads, writes, and history', async () => {
    const call = await openConnectedCall();
    const suratRead = await getCall(
      requestFor(org.suratMonitor, `/api/monitoring/calls/${call.id}`, 'GET'),
      context(call.id),
    );
    expect(suratRead.status).toBe(403);
    const otherLobby = await acceptCall(
      requestFor(org.otherLobbyUser, `/api/monitoring/calls/${call.id}/accept`, 'POST'),
      context(call.id),
    );
    expect(otherLobby.status).toBe(403);
    const adminCall = await callLobby(
      requestFor(org.divisionAdmin, `/api/monitoring/lobbies/${org.vatva.id}/call`, 'POST'),
      context(org.vatva.id),
    );
    expect(adminCall.status).toBe(403);
    const anonymous = await listLobbies(requestFor(null, '/api/monitoring/lobbies', 'GET'));
    expect(anonymous.status).toBe(401);
    const superRead = await listLobbies(requestFor(org.superAdmin, '/api/monitoring/lobbies', 'GET'));
    expect(superRead.status).toBe(403);

    const own = await jsonOf(await listLobbies(requestFor(org.ahmedabadMonitor, '/api/monitoring/lobbies', 'GET')));
    expect(own.data.items.some((item: { id: number }) => item.id === org.suratLobby.id)).toBe(false);
    const system = await jsonOf(await listLobbies(requestFor(org.system, '/api/monitoring/lobbies', 'GET')));
    expect(system.data.items.some((item: { id: number }) => item.id === org.suratLobby.id)).toBe(true);
    const systemCall = await callLobby(
      requestFor(org.system, `/api/monitoring/lobbies/${org.vatva.id}/call`, 'POST'),
      context(org.vatva.id),
    );
    expect(systemCall.status).toBe(403);

    await presence(requestFor(org.lobbyUser, '/api/monitoring/presence', 'POST', { presence: 'ONLINE' }));
    const online = await jsonOf(await listLobbies(requestFor(org.lobbyUser, '/api/monitoring/lobbies', 'GET')));
    expect(online.data.items[0].presence).toBe('ONLINE');
    expect(online.data.items[0].call.status).toBe('CONNECTED');

    const started = await jsonOf(await startRecording(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/calls/${call.id}/recording/start`, 'POST'),
      context(call.id),
    ));
    const recordingId = started.data.call.recording.activeId as number;
    await stopRecording(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/calls/${call.id}/recording/${recordingId}/stop`, 'POST'),
      context(call.id, { recordingId: String(recordingId) }),
    );
    await endCall(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/calls/${call.id}/end`, 'POST'),
      context(call.id),
    );
    const calls = await jsonOf(await history(requestFor(org.ahmedabadMonitor, '/api/monitoring/history', 'GET')));
    expect(calls.data.items[0].status).toBe('COMPLETED');
    expect(calls.data.items[0].lobbyName).toBe('Vatva');
    expect(calls.data.items[0].participantCount).toBeGreaterThan(0);
    const hidden = await history(requestFor(org.suratMonitor, '/api/monitoring/history', 'GET'));
    const hiddenBody = await jsonOf(hidden);
    expect(hiddenBody.data.items).toHaveLength(0);

    const rows = await jsonOf(await recordings(requestFor(org.ahmedabadMonitor, '/api/monitoring/recordings', 'GET')));
    expect(rows.data.items.length).toBeGreaterThan(0);
    const file = await recordingFile(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/recordings/${rows.data.items.find((item: { canDownload: boolean }) => item.canDownload).id}/file`, 'GET'),
      context(rows.data.items.find((item: { canDownload: boolean }) => item.canDownload).id),
    );
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toContain('attachment');
    const leaked = await recordings(requestFor(org.suratMonitor, '/api/monitoring/recordings', 'GET'));
    expect((await jsonOf(leaked)).data.items).toHaveLength(0);
  });

  it('saves a local video recording and leaves the call connected', async () => {
    const call = await openConnectedCall();
    const started = await jsonOf(await startRecording(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/calls/${call.id}/recording/start`, 'POST'),
      context(call.id),
    ));
    const recordingId = started.data.call.recording.activeId as number;
    const bytes = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)]);
    const headers = new Headers({ 'content-type': 'video/webm' });
    headers.set('x-test-user', JSON.stringify(toSessionClaims(org.ahmedabadMonitor)));
    const saved = await saveRecordingMedia(
      new NextRequest(`http://localhost/api/monitoring/calls/${call.id}/recording/${recordingId}/media`, {
        method: 'POST',
        headers,
        body: bytes,
      }),
      context(call.id, { recordingId: String(recordingId) }),
    );
    expect(saved.status).toBe(200);
    const savedBody = await jsonOf(saved);
    expect(JSON.stringify(savedBody)).not.toMatch(/storageKey|local\/recordings|password/);
    expect(savedBody.data.call.status).toBe('CONNECTED');

    const denied = await saveRecordingMedia(
      new NextRequest(`http://localhost/api/monitoring/calls/${call.id}/recording/${recordingId}/media`, {
        method: 'POST',
        headers: new Headers({
          'content-type': 'video/webm',
          'x-test-user': JSON.stringify(toSessionClaims(org.lobbyUser)),
        }),
        body: bytes,
      }),
      context(call.id, { recordingId: String(recordingId) }),
    );
    expect(denied.status).toBe(403);

    const stopped = await jsonOf(await stopRecording(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/calls/${call.id}/recording/${recordingId}/stop`, 'POST'),
      context(call.id, { recordingId: String(recordingId) }),
    ));
    expect(stopped.data.status).toBe('CONNECTED');
    const rows = await jsonOf(await recordings(
      requestFor(org.ahmedabadMonitor, '/api/monitoring/recordings', 'GET'),
    ));
    const row = rows.data.items.find((item: { id: number }) => item.id === recordingId);
    expect(row.canPlay).toBe(true);
    expect(row.canDownload).toBe(true);
    const file = await recordingFile(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/recordings/${recordingId}/file?play=1`, 'GET'),
      context(recordingId),
    );
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toContain('video/webm');
    expect(file.headers.get('content-disposition')).toContain('inline');
  });

  it('forwards the video offer to the lobby and leaves the call connected', async () => {
    const call = await openConnectedCall();
    const posted = await sendSignal(
      requestFor(org.ahmedabadMonitor, `/api/monitoring/calls/${call.id}/signal`, 'POST', {
        type: 'offer',
        description: { type: 'offer', sdp: 'v=0' },
      }),
      context(call.id),
    );
    expect(posted.status).toBe(201);
    const listed = await jsonOf(await readSignals(
      requestFor(org.lobbyUser, `/api/monitoring/calls/${call.id}/signal?after=0`, 'GET'),
      context(call.id),
    ));
    expect(listed.data.signals).toHaveLength(1);
    expect(listed.data.signals[0].type).toBe('offer');
    expect(listed.data.signals[0].description.sdp).toBe('v=0');
    const current = await jsonOf(await getCall(
      requestFor(org.lobbyUser, `/api/monitoring/calls/${call.id}`, 'GET'),
      context(call.id),
    ));
    expect(current.data.status).toBe('CONNECTED');
    const outsider = await sendSignal(
      requestFor(org.suratMonitor, `/api/monitoring/calls/${call.id}/signal`, 'POST', {
        type: 'offer',
        description: { type: 'offer', sdp: 'v=0' },
      }),
      context(call.id),
    );
    expect(outsider.status).toBe(403);
  });
});
