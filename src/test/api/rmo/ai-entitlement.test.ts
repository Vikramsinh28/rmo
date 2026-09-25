import { GET as getDivisionAI, PATCH as patchDivisionAI } from '@/app/api/admin/divisions/[id]/ai/route';
import { GET as getMyAI } from '@/app/api/monitoring/ai/route';
import { GET as getCallAI } from '@/app/api/monitoring/calls/[id]/ai/route';
import { POST as acceptCall } from '@/app/api/monitoring/calls/[id]/accept/route';
import { POST as callLobby } from '@/app/api/monitoring/lobbies/[id]/call/route';
import { prisma } from '@/lib/prisma';
import { toSessionClaims } from '@/lib/rmo/session-claims';
import { resolveDivisionAICapabilities } from '@/services/internal/rmo/ai-entitlement';
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
      role: input.rmoRole === 'SYSTEM_ADMIN' || input.rmoRole === 'SUPER_ADMIN' ? 'ADMIN' : 'USER',
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

describe('Division AI entitlement', () => {
  let system: Awaited<ReturnType<typeof userWith>>;
  let superAdmin: Awaited<ReturnType<typeof userWith>>;
  let ahmedabadAdmin: Awaited<ReturnType<typeof userWith>>;
  let monitor: Awaited<ReturnType<typeof userWith>>;
  let lobbyUser: Awaited<ReturnType<typeof userWith>>;
  let crew: Awaited<ReturnType<typeof userWith>>;
  let ahmedabad: { id: number; name: string };
  let surat: { id: number; name: string };
  let lobby: { id: number };

  beforeEach(async () => {
    await cleanupDatabase();
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
        name: 'ADI Lobby 1',
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
    superAdmin = await userWith({
      name: 'Super',
      email: `super-${Date.now()}@local`,
      loginId: `super-${Date.now()}`,
      rmoRole: 'SUPER_ADMIN',
    });
    ahmedabadAdmin = await userWith({
      name: 'ADI Admin',
      email: `adi-admin-${Date.now()}@local`,
      loginId: `adi-admin-${Date.now()}`,
      rmoRole: 'DIVISION_ADMIN',
      homeZoneId: zone.id,
      homeDivisionId: ahmedabad.id,
    });
    monitor = await userWith({
      name: 'Monitor',
      email: `mon-${Date.now()}@local`,
      loginId: `mon-${Date.now()}`,
      rmoRole: 'DIVISION_MONITOR',
      homeZoneId: zone.id,
      homeDivisionId: ahmedabad.id,
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
  });

  afterAll(async () => {
    await cleanupDatabase();
    await prisma.$disconnect();
  });

  it('resolves expiry, inactive, future start, and feature flags without mutating storage', () => {
    const now = new Date('2026-06-15T12:00:00.000Z');
    const base = {
      enabled: true,
      plan: 'PREMIUM' as const,
      status: 'ACTIVE' as const,
      startsAt: null as Date | null,
      expiresAt: null as Date | null,
      faceIdentification: true,
      fatigueDetection: false,
      impairmentDetection: true,
      behaviorMonitoring: false,
    };

    expect(resolveDivisionAICapabilities(1, 'A', null, now).available).toBe(false);
    expect(resolveDivisionAICapabilities(1, 'A', { ...base, enabled: false }, now).available).toBe(false);
    expect(resolveDivisionAICapabilities(1, 'A', { ...base, status: 'INACTIVE' }, now).available).toBe(false);
    expect(
      resolveDivisionAICapabilities(
        1,
        'A',
        { ...base, startsAt: new Date('2026-07-01T00:00:00.000Z') },
        now,
      ).available,
    ).toBe(false);
    expect(
      resolveDivisionAICapabilities(
        1,
        'A',
        { ...base, expiresAt: new Date('2026-01-01T00:00:00.000Z') },
        now,
      ).available,
    ).toBe(false);

    const active = resolveDivisionAICapabilities(1, 'A', base, now);
    expect(active.available).toBe(true);
    expect(active.features.faceIdentification).toBe(true);
    expect(active.features.fatigueDetection).toBe(false);
  });

  it('lets system admin enable, update features, and disable AI for a division', async () => {
    const enabled = await patchDivisionAI(
      await requestFor(system, `/api/admin/divisions/${ahmedabad.id}/ai`, 'PATCH', {
        enabled: true,
        plan: 'PREMIUM',
        status: 'ACTIVE',
        startsAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2027-12-31T00:00:00.000Z',
        features: {
          faceIdentification: true,
          fatigueDetection: true,
          impairmentDetection: true,
          behaviorMonitoring: false,
        },
      }),
      context(ahmedabad.id),
    );
    const enabledBody = await enabled.json();
    expect(enabled.status).toBe(200);
    expect(enabledBody.data.capabilities.available).toBe(true);
    expect(enabledBody.data.capabilities.features.behaviorMonitoring).toBe(false);

    const audits = await prisma.auditLog.findMany({
      where: { targetType: 'division_ai', targetId: String(ahmedabad.id) },
      orderBy: { id: 'asc' },
    });
    expect(audits.some(item => item.action === 'ai.entitlement.enabled')).toBe(true);
    expect(audits.every(item => {
      const raw = JSON.stringify(item.metadata || {});
      return !raw.includes('password') && !raw.includes('TestPassword');
    })).toBe(true);

    const disabled = await patchDivisionAI(
      await requestFor(system, `/api/admin/divisions/${ahmedabad.id}/ai`, 'PATCH', {
        enabled: false,
        status: 'INACTIVE',
      }),
      context(ahmedabad.id),
    );
    const disabledBody = await disabled.json();
    expect(disabled.status).toBe(200);
    expect(disabledBody.data.capabilities.available).toBe(false);
    const after = await prisma.auditLog.findMany({
      where: { action: 'ai.entitlement.disabled', targetId: String(ahmedabad.id) },
    });
    expect(after.length).toBeGreaterThan(0);
  });

  it('blocks unauthenticated and unauthorized writers', async () => {
    const anon = await patchDivisionAI(
      await requestFor(null, `/api/admin/divisions/${ahmedabad.id}/ai`, 'PATCH', { enabled: true }),
      context(ahmedabad.id),
    );
    expect(anon.status).toBe(401);

    for (const actor of [superAdmin, ahmedabadAdmin, monitor, lobbyUser, crew]) {
      const denied = await patchDivisionAI(
        await requestFor(actor, `/api/admin/divisions/${ahmedabad.id}/ai`, 'PATCH', {
          enabled: true,
          status: 'ACTIVE',
        }),
        context(ahmedabad.id),
      );
      expect(denied.status).toBe(403);
    }
  });

  it('lets division admin read own division only', async () => {
    await prisma.divisionAIEntitlement.create({
      data: {
        divisionId: ahmedabad.id,
        enabled: true,
        plan: 'PREMIUM',
        status: 'ACTIVE',
        faceIdentification: true,
      },
    });

    const own = await getDivisionAI(
      await requestFor(ahmedabadAdmin, `/api/admin/divisions/${ahmedabad.id}/ai`, 'GET'),
      context(ahmedabad.id),
    );
    expect(own.status).toBe(200);
    const ownBody = await own.json();
    expect(ownBody.data.capabilities.available).toBe(true);

    const other = await getDivisionAI(
      await requestFor(ahmedabadAdmin, `/api/admin/divisions/${surat.id}/ai`, 'GET'),
      context(surat.id),
    );
    expect(other.status).toBe(403);

    const mine = await getMyAI(await requestFor(ahmedabadAdmin, '/api/monitoring/ai', 'GET'));
    const mineBody = await mine.json();
    expect(mine.status).toBe(200);
    expect(mineBody.data.divisionId).toBe(ahmedabad.id);
  });

  it('exposes call capabilities without starting AI processing', async () => {
    await prisma.divisionAIEntitlement.create({
      data: {
        divisionId: ahmedabad.id,
        enabled: true,
        plan: 'BASIC',
        status: 'ACTIVE',
        fatigueDetection: true,
      },
    });

    const dial = await callLobby(
      await requestFor(monitor, `/api/monitoring/lobbies/${lobby.id}/call`, 'POST'),
      context(lobby.id),
    );
    const dialBody = await dial.json();
    expect(dialBody.success).toBe(true);
    const callId = dialBody.data.id as number;

    const accepted = await acceptCall(
      await requestFor(lobbyUser, `/api/monitoring/calls/${callId}/accept`, 'POST'),
      context(callId),
    );
    const acceptedBody = await accepted.json();
    expect(acceptedBody.data.status).toBe('CONNECTED');

    const monitorView = await getCallAI(
      await requestFor(monitor, `/api/monitoring/calls/${callId}/ai`, 'GET'),
      context(callId),
    );
    const monitorBody = await monitorView.json();
    expect(monitorView.status).toBe(200);
    expect(monitorBody.data.ai.enabled).toBe(true);
    expect(monitorBody.data.ai.features.fatigueDetection).toBe(true);
    expect(monitorBody.data.ai.features.faceIdentification).toBe(false);
    expect(monitorBody.data.ai.moduleNote).toContain('not yet active');

    const lobbyView = await getCallAI(
      await requestFor(lobbyUser, `/api/monitoring/calls/${callId}/ai`, 'GET'),
      context(callId),
    );
    expect(lobbyView.status).toBe(200);

    const crewDenied = await getCallAI(
      await requestFor(crew, `/api/monitoring/calls/${callId}/ai`, 'GET'),
      context(callId),
    );
    expect(crewDenied.status).toBe(403);

    const crewMine = await getMyAI(await requestFor(crew, '/api/monitoring/ai', 'GET'));
    expect(crewMine.status).toBe(403);

    const call = await prisma.lobbyCall.findUnique({ where: { id: callId } });
    expect(call?.status).toBe('CONNECTED');
  });

  it('treats expired entitlement as unavailable while leaving status ACTIVE in storage', async () => {
    await prisma.divisionAIEntitlement.create({
      data: {
        divisionId: ahmedabad.id,
        enabled: true,
        plan: 'ENTERPRISE',
        status: 'ACTIVE',
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        faceIdentification: true,
      },
    });

    const response = await getDivisionAI(
      await requestFor(system, `/api/admin/divisions/${ahmedabad.id}/ai`, 'GET'),
      context(ahmedabad.id),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.entitlement.status).toBe('ACTIVE');
    expect(body.data.capabilities.available).toBe(false);
    expect(body.data.capabilities.features.faceIdentification).toBe(false);
  });
});
