import { POST as startAI } from '@/app/api/monitoring/calls/[id]/ai/start/route';
import { POST as stopAI } from '@/app/api/monitoring/calls/[id]/ai/stop/route';
import { GET as statusAI } from '@/app/api/monitoring/calls/[id]/ai/status/route';
import { POST as acceptCall } from '@/app/api/monitoring/calls/[id]/accept/route';
import { POST as callLobby } from '@/app/api/monitoring/lobbies/[id]/call/route';
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

type Role = 'SYSTEM_ADMIN' | 'DIVISION_MONITOR' | 'LOBBY_USER' | 'CREW_USER' | 'DIVISION_ADMIN';

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
      role: input.rmoRole === 'SYSTEM_ADMIN' ? 'ADMIN' : 'USER',
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

function context(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

describe('AI processing lifecycle', () => {
  let system: Awaited<ReturnType<typeof userWith>>;
  let monitor: Awaited<ReturnType<typeof userWith>>;
  let otherMonitor: Awaited<ReturnType<typeof userWith>>;
  let lobbyUser: Awaited<ReturnType<typeof userWith>>;
  let crew: Awaited<ReturnType<typeof userWith>>;
  let ahmedabad: { id: number };
  let surat: { id: number };
  let lobby: { id: number };
  let callId: number;

  beforeEach(async () => {
    await cleanupDatabase();
    process.env.AI_SERVICE_URL = 'http://127.0.0.1:9';
    process.env.AI_SERVICE_TOKEN = 'test-token';

    const zone = await prisma.zone.create({
      data: { name: 'West', code: `W-${Date.now()}`, status: 'ACTIVE' },
    });
    ahmedabad = await prisma.division.create({
      data: { name: 'Ahmedabad', code: `ADI-${Date.now()}`, status: 'ACTIVE', zoneId: zone.id },
    });
    surat = await prisma.division.create({
      data: { name: 'Surat', code: `ST-${Date.now()}`, status: 'ACTIVE', zoneId: zone.id },
    });
    lobby = await prisma.lobby.create({
      data: {
        name: 'ADI Lobby',
        code: `L-${Date.now()}`,
        status: 'ACTIVE',
        divisionId: ahmedabad.id,
      },
    });
    await prisma.lobbyRoom.create({
      data: {
        lobbyId: lobby.id,
        roomKey: `lobby-${lobby.id}`,
        status: 'ACTIVE',
        presence: 'ONLINE',
        lastSeenAt: new Date(),
      },
    });

    system = await userWith({
      name: 'System',
      email: `sys-${Date.now()}@local`,
      loginId: `sys-${Date.now()}`,
      rmoRole: 'SYSTEM_ADMIN',
    });
    monitor = await userWith({
      name: 'Monitor',
      email: `mon-${Date.now()}@local`,
      loginId: `mon-${Date.now()}`,
      rmoRole: 'DIVISION_MONITOR',
      homeZoneId: zone.id,
      homeDivisionId: ahmedabad.id,
    });
    otherMonitor = await userWith({
      name: 'Other',
      email: `omon-${Date.now()}@local`,
      loginId: `omon-${Date.now()}`,
      rmoRole: 'DIVISION_MONITOR',
      homeZoneId: zone.id,
      homeDivisionId: surat.id,
    });
    lobbyUser = await userWith({
      name: 'Lobby',
      email: `lobby-${Date.now()}@local`,
      loginId: `lobby-${Date.now()}`,
      rmoRole: 'LOBBY_USER',
      homeZoneId: zone.id,
      homeDivisionId: ahmedabad.id,
      homeLobbyId: lobby.id,
    });
    crew = await userWith({
      name: 'Crew',
      email: `crew-${Date.now()}@local`,
      loginId: `crew-${Date.now()}`,
      rmoRole: 'CREW_USER',
      homeZoneId: zone.id,
      homeDivisionId: ahmedabad.id,
      homeLobbyId: lobby.id,
    });

    const dial = await callLobby(
      await requestFor(monitor, `/api/monitoring/lobbies/${lobby.id}/call`, 'POST'),
      context(lobby.id),
    );
    const dialBody = await dial.json();
    callId = dialBody.data.id;
    await acceptCall(
      await requestFor(lobbyUser, `/api/monitoring/calls/${callId}/accept`, 'POST'),
      context(callId),
    );
  });

  afterAll(async () => {
    await cleanupDatabase();
    await prisma.$disconnect();
  });

  it('rejects unauthenticated and unauthorized AI start', async () => {
    const anon = await startAI(
      await requestFor(null, `/api/monitoring/calls/${callId}/ai/start`, 'POST'),
      context(callId),
    );
    expect(anon.status).toBe(401);

    const crewDenied = await startAI(
      await requestFor(crew, `/api/monitoring/calls/${callId}/ai/start`, 'POST'),
      context(callId),
    );
    expect(crewDenied.status).toBe(403);
  });

  it('blocks start when entitlement is missing or expired', async () => {
    const denied = await startAI(
      await requestFor(monitor, `/api/monitoring/calls/${callId}/ai/start`, 'POST'),
      context(callId),
    );
    const deniedBody = await denied.json();
    expect(denied.status).toBe(403);
    expect(deniedBody.error).toBe('AI_MONITORING_NOT_ENABLED');

    await prisma.divisionAIEntitlement.create({
      data: {
        divisionId: ahmedabad.id,
        enabled: true,
        plan: 'PREMIUM',
        status: 'ACTIVE',
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    });
    const expired = await startAI(
      await requestFor(monitor, `/api/monitoring/calls/${callId}/ai/start`, 'POST'),
      context(callId),
    );
    expect(expired.status).toBe(403);
  });

  it('starts and stops AI when entitled and keeps the live call connected', async () => {
    await prisma.divisionAIEntitlement.create({
      data: {
        divisionId: ahmedabad.id,
        enabled: true,
        plan: 'PREMIUM',
        status: 'ACTIVE',
        faceIdentification: true,
      },
    });

    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/sessions/start') && init?.method === 'POST') {
        return new Response(JSON.stringify({ status: 'RUNNING', framesReceived: 0, framesProcessed: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/stop')) {
        return new Response(JSON.stringify({ status: 'STOPPED' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/status')) {
        return new Response(JSON.stringify({
          status: 'RUNNING',
          framesReceived: 3,
          framesProcessed: 3,
          processingFps: 1,
          lastFrameAt: new Date().toISOString(),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    });

    const started = await startAI(
      await requestFor(monitor, `/api/monitoring/calls/${callId}/ai/start`, 'POST'),
      context(callId),
    );
    const startedBody = await started.json();
    expect(started.status).toBe(200);
    expect(startedBody.data.status).toBe('RUNNING');

    const duplicate = await startAI(
      await requestFor(monitor, `/api/monitoring/calls/${callId}/ai/start`, 'POST'),
      context(callId),
    );
    expect(duplicate.status).toBe(200);

    const other = await startAI(
      await requestFor(otherMonitor, `/api/monitoring/calls/${callId}/ai/start`, 'POST'),
      context(callId),
    );
    expect(other.status).toBe(403);

    const status = await statusAI(
      await requestFor(monitor, `/api/monitoring/calls/${callId}/ai/status`, 'GET'),
      context(callId),
    );
    const statusBody = await status.json();
    expect(status.status).toBe(200);
    expect(statusBody.data.processing.status).toBe('RUNNING');
    expect(statusBody.data.callStatus).toBe('CONNECTED');

    const stopped = await stopAI(
      await requestFor(monitor, `/api/monitoring/calls/${callId}/ai/stop`, 'POST'),
      context(callId),
    );
    const stoppedBody = await stopped.json();
    expect(stopped.status).toBe(200);
    expect(stoppedBody.data.status).toBe('STOPPED');

    const call = await prisma.lobbyCall.findUnique({ where: { id: callId } });
    expect(call?.status).toBe('CONNECTED');

    const again = await stopAI(
      await requestFor(monitor, `/api/monitoring/calls/${callId}/ai/stop`, 'POST'),
      context(callId),
    );
    expect(again.status).toBe(200);

    void system;
    fetchMock.mockRestore();
  });
});
