import { POST as frameAI } from '@/app/api/monitoring/calls/[id]/ai/frames/route';
import { POST as startAI } from '@/app/api/monitoring/calls/[id]/ai/start/route';
import { GET as statusAI } from '@/app/api/monitoring/calls/[id]/ai/status/route';
import { POST as stopAI } from '@/app/api/monitoring/calls/[id]/ai/stop/route';
import { POST as acceptCall } from '@/app/api/monitoring/calls/[id]/accept/route';
import { GET as monitoringEvents } from '@/app/api/monitoring/events/route';
import { POST as callLobby } from '@/app/api/monitoring/lobbies/[id]/call/route';
import { GET as getEvent } from '@/app/api/safety-events/[id]/route';
import { POST as reviewEvent } from '@/app/api/safety-events/[id]/review/route';
import { GET as listEvents } from '@/app/api/safety-events/route';
import { prisma } from '@/lib/prisma';
import {
  publishMonitoringEvent,
  subscribeMonitoringEvents,
  type MonitoringEvent,
} from '@/lib/rmo/monitoring-events';
import { toSessionClaims } from '@/lib/rmo/session-claims';
import { hashPassword } from '@/lib/utils';
import {
  flushSafetyEpisodesForTests,
  resetSafetyEpisodeCacheForTests,
} from '@/services/internal/rmo/safety-events';
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

type Role = 'SYSTEM_ADMIN' | 'DIVISION_MONITOR' | 'LOBBY_USER' | 'DIVISION_ADMIN';
type User = Awaited<ReturnType<typeof userWith>>;

let seq = 0;

async function userWith(input: {
  rmoRole: Role;
  homeZoneId?: number;
  homeDivisionId?: number;
  homeLobbyId?: number;
}) {
  seq += 1;
  const key = `${input.rmoRole.toLowerCase()}-${Date.now()}-${seq}`;
  return prisma.user.create({
    data: {
      name: key,
      email: `${key}@local`,
      loginId: key,
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

function requestFor(user: User | null, path: string, method: string, body?: unknown) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (user) headers.set('x-test-user', JSON.stringify(toSessionClaims(user)));
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function frameRequest(user: User, callId: number) {
  const headers = new Headers({ 'content-type': 'application/octet-stream' });
  headers.set('x-test-user', JSON.stringify(toSessionClaims(user)));
  return new NextRequest(`http://localhost/api/monitoring/calls/${callId}/ai/frames`, {
    method: 'POST',
    headers,
    body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  });
}

function context(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

function personWith(episode: Record<string, unknown> | null, status = 'HIGH_INDICATORS') {
  return {
    trackId: 'Person-1',
    visualStatus: status,
    impairment: {
      status,
      score: 0.78,
      confidence: 0.7,
      evidence: ['Lateral sway while standing (0.06 body heights)'],
      limitations: [],
      modelVersion: 'visual-indicators-rules-v1',
      episode,
    },
  };
}

const EPISODE = {
  id: 'Person-1-e1',
  active: true,
  startedAt: '2026-09-28T10:00:00.000Z',
  endedAt: null,
  peakStatus: 'ELEVATED_INDICATORS',
  peakScore: 0.55,
  peakConfidence: 0.6,
  evidence: ['Lateral sway while standing (0.06 body heights)'],
  groups: { sway: 0.8, posture: 0.62, gait: null },
  features: { windowSeconds: 10 },
};

describe('Safety events', () => {
  let monitor: User;
  let otherMonitor: User;
  let lobbyUser: User;
  let divisionId: number;
  let callId: number;
  let framePersons: unknown[];

  beforeEach(async () => {
    await cleanupDatabase();
    resetSafetyEpisodeCacheForTests();
    process.env.AI_SERVICE_URL = 'http://127.0.0.1:9';
    process.env.IDENTITY_RESOLUTION_ENABLED = 'false';

    const zone = await prisma.zone.create({
      data: { name: 'West', code: `W-${Date.now()}`, status: 'ACTIVE' },
    });
    const division = await prisma.division.create({
      data: { name: 'Ahmedabad', code: `ADI-${Date.now()}`, status: 'ACTIVE', zoneId: zone.id },
    });
    const other = await prisma.division.create({
      data: { name: 'Surat', code: `ST-${Date.now()}`, status: 'ACTIVE', zoneId: zone.id },
    });
    divisionId = division.id;
    const lobby = await prisma.lobby.create({
      data: { name: 'ADI Lobby', code: `L-${Date.now()}`, status: 'ACTIVE', divisionId },
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
    monitor = await userWith({ rmoRole: 'DIVISION_MONITOR', homeZoneId: zone.id, homeDivisionId: divisionId });
    otherMonitor = await userWith({ rmoRole: 'DIVISION_MONITOR', homeZoneId: zone.id, homeDivisionId: other.id });
    lobbyUser = await userWith({
      rmoRole: 'LOBBY_USER',
      homeZoneId: zone.id,
      homeDivisionId: divisionId,
      homeLobbyId: lobby.id,
    });
    await prisma.divisionAIEntitlement.create({
      data: {
        divisionId,
        enabled: true,
        plan: 'PREMIUM',
        status: 'ACTIVE',
        impairmentDetection: true,
      },
    });

    const dial = await callLobby(
      requestFor(monitor, `/api/monitoring/lobbies/${lobby.id}/call`, 'POST'),
      context(lobby.id),
    );
    callId = (await dial.json()).data.id;
    await acceptCall(
      requestFor(lobbyUser, `/api/monitoring/calls/${callId}/accept`, 'POST'),
      context(callId),
    );

    framePersons = [];
    jest.spyOn(global, 'fetch').mockImplementation(async input => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      if (url.includes('/sessions/start')) return json({ status: 'RUNNING' });
      if (url.includes('/stop')) return json({ status: 'STOPPED' });
      if (url.includes('/frames') || url.includes('/status')) {
        return json({
          status: 'RUNNING',
          framesReceived: 1,
          framesProcessed: 1,
          processingFps: 5,
          lastFrameAt: new Date().toISOString(),
          persons: framePersons,
          personCount: framePersons.length,
        });
      }
      return new Response('{}', { status: 404 });
    });

    const started = await startAI(
      requestFor(monitor, `/api/monitoring/calls/${callId}/ai/start`, 'POST'),
      context(callId),
    );
    expect(started.status).toBe(200);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanupDatabase();
    await prisma.$disconnect();
  });

  async function sendFrame(persons: unknown[]) {
    framePersons = persons;
    const response = await frameAI(frameRequest(lobbyUser, callId), context(callId));
    expect(response.status).toBe(200);
    await flushSafetyEpisodesForTests();
  }

  it('persists one event per episode, escalates it, and closes it when AI stops', async () => {
    await sendFrame([personWith(null, 'MONITORING')]);
    expect(await prisma.safetyEvent.count()).toBe(0);

    await sendFrame([personWith(EPISODE, 'ELEVATED_INDICATORS')]);
    await sendFrame([personWith(EPISODE, 'ELEVATED_INDICATORS')]);
    await sendFrame([personWith({
      ...EPISODE,
      peakStatus: 'HIGH_INDICATORS',
      peakScore: 0.78,
      peakConfidence: 0.7,
    })]);

    const events = await prisma.safetyEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('HIGH_INDICATORS');
    expect(events[0].peakScore).toBeCloseTo(0.78);
    expect(events[0].status).toBe('PENDING_REVIEW');
    expect(events[0].endedAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'safety_event.created' } })).toBe(1);

    await stopAI(
      requestFor(monitor, `/api/monitoring/calls/${callId}/ai/stop`, 'POST'),
      context(callId),
    );
    const closed = await prisma.safetyEvent.findUniqueOrThrow({ where: { id: events[0].id } });
    expect(closed.endedAt).not.toBeNull();
  });

  it('scopes listing to the division and restricts review', async () => {
    await sendFrame([personWith(EPISODE, 'ELEVATED_INDICATORS')]);
    const event = await prisma.safetyEvent.findFirstOrThrow();

    const mine = await listEvents(requestFor(monitor, '/api/safety-events', 'GET'));
    const mineBody = await mine.json();
    expect(mine.status).toBe(200);
    expect(mineBody.data.total).toBe(1);
    expect(mineBody.data.pending).toBe(1);
    expect(mineBody.data.items[0].evidence).toEqual(EPISODE.evidence);

    const others = await listEvents(requestFor(otherMonitor, '/api/safety-events', 'GET'));
    expect((await others.json()).data.total).toBe(0);

    const hidden = await getEvent(
      requestFor(otherMonitor, `/api/safety-events/${event.id}`, 'GET'),
      context(event.id),
    );
    expect(hidden.status).toBe(404);

    const lobbyDenied = await listEvents(requestFor(lobbyUser, '/api/safety-events', 'GET'));
    expect(lobbyDenied.status).toBe(403);

    const noNote = await reviewEvent(
      requestFor(monitor, `/api/safety-events/${event.id}/review`, 'POST', {
        outcome: 'IMPAIRMENT_CONFIRMED',
      }),
      context(event.id),
    );
    expect(noNote.status).toBe(400);

    const badOutcome = await reviewEvent(
      requestFor(monitor, `/api/safety-events/${event.id}/review`, 'POST', { outcome: 'GUILTY' }),
      context(event.id),
    );
    expect(badOutcome.status).toBe(400);

    const reviewed = await reviewEvent(
      requestFor(monitor, `/api/safety-events/${event.id}/review`, 'POST', {
        outcome: 'IMPAIRMENT_CONFIRMED',
        note: 'Supervisor observed unsteady gait.',
        breathTestPerformed: true,
        breathTestPositive: true,
      }),
      context(event.id),
    );
    const reviewedBody = await reviewed.json();
    expect(reviewed.status).toBe(200);
    expect(reviewedBody.data.status).toBe('CONFIRMED');
    expect(reviewedBody.data.review.breathTestPositive).toBe(true);
    expect(reviewedBody.data.review.reviewedBy.id).toBe(monitor.id);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'safety_event.reviewed' } });
    expect(audit?.actorId).toBe(monitor.id);
    expect(audit?.targetId).toBe(String(event.id));
  });

  it('publishes live safety alerts and review updates', async () => {
    const received: MonitoringEvent[] = [];
    const unsubscribe = subscribeMonitoringEvents(event => received.push(event));
    try {
      await sendFrame([personWith(EPISODE, 'ELEVATED_INDICATORS')]);
      await sendFrame([personWith(EPISODE, 'ELEVATED_INDICATORS')]);
      await sendFrame([personWith({ ...EPISODE, peakStatus: 'HIGH_INDICATORS', peakScore: 0.8 })]);
      const event = await prisma.safetyEvent.findFirstOrThrow();
      await reviewEvent(
        requestFor(monitor, `/api/safety-events/${event.id}/review`, 'POST', {
          outcome: 'NOT_IMPAIRED',
        }),
        context(event.id),
      );
    } finally {
      unsubscribe();
    }
    const safety = received.filter(event => event.type.startsWith('safety.'));
    expect(safety.map(event => event.type)).toEqual([
      'safety.alert',
      'safety.escalated',
      'safety.reviewed',
    ]);
    expect(safety[0]).toMatchObject({
      divisionId,
      callId,
      safety: { severity: 'ELEVATED_INDICATORS', trackId: 'Person-1', lobbyName: 'ADI Lobby' },
    });
    expect(safety[2].safety?.status).toBe('DISMISSED');
  });

  it('streams safety alerts to division staff only', async () => {
    const readNext = async (user: User) => {
      const controller = new AbortController();
      const headers = new Headers();
      headers.set('x-test-user', JSON.stringify(toSessionClaims(user)));
      const response = await monitoringEvents(new NextRequest('http://localhost/api/monitoring/events', {
        headers,
        signal: controller.signal,
      }));
      const reader = response.body!.getReader();
      await reader.read();
      publishMonitoringEvent({
        type: 'safety.alert',
        divisionId,
        lobbyId: 1,
        callId,
      });
      const chunk = await Promise.race([
        reader.read().then(result => new TextDecoder().decode(result.value)),
        new Promise<string>(resolve => setTimeout(() => resolve(''), 200)),
      ]);
      controller.abort();
      return chunk;
    };

    expect(await readNext(monitor)).toContain('safety.alert');
    expect(await readNext(otherMonitor)).toBe('');
    expect(await readNext(lobbyUser)).toBe('');
  });

  it('returns a live overlay to staff only and lists events per call', async () => {
    framePersons = [{
      ...personWith(EPISODE, 'ELEVATED_INDICATORS'),
      identity: { status: 'UNKNOWN', displayName: null },
      tracking: { boundingBox: { x: 0.2, y: 0.1, width: 0.3, height: 0.8 } },
    }];
    const staff = await frameAI(frameRequest(monitor, callId), context(callId));
    const staffBody = await staff.json();
    expect(staff.status).toBe(200);
    expect(staffBody.data.overlay).toEqual([{
      trackId: 'Person-1',
      box: { x: 0.2, y: 0.1, width: 0.3, height: 0.8 },
      name: null,
      identityStatus: 'UNKNOWN',
      visualStatus: 'ELEVATED_INDICATORS',
    }]);

    const lobby = await frameAI(frameRequest(lobbyUser, callId), context(callId));
    expect((await lobby.json()).data.overlay).toEqual([]);
    await flushSafetyEpisodesForTests();

    const thisCall = await listEvents(
      requestFor(monitor, `/api/safety-events?callId=${callId}`, 'GET'),
    );
    expect((await thisCall.json()).data.total).toBe(1);
    const otherCall = await listEvents(
      requestFor(monitor, `/api/safety-events?callId=${callId + 999}`, 'GET'),
    );
    expect((await otherCall.json()).data.total).toBe(0);

    await stopAI(
      requestFor(monitor, `/api/monitoring/calls/${callId}/ai/stop`, 'POST'),
      context(callId),
    );
    const status = await statusAI(
      requestFor(monitor, `/api/monitoring/calls/${callId}/ai/status`, 'GET'),
      context(callId),
    );
    const statusBody = (await status.json()).data;
    expect(statusBody.processing).toBeNull();
    expect(statusBody.everStarted).toBe(true);
  });

  it('reopens the AI session when the AI service lost it', async () => {
    const original = (global.fetch as jest.Mock).getMockImplementation()!;
    let lost = true;
    const calls: string[] = [];
    (global.fetch as jest.Mock).mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/frames') && lost) {
        return new Response('{"detail":"Session not found"}', { status: 404 });
      }
      if (url.includes('/sessions/start')) lost = false;
      return original(input, init);
    });
    framePersons = [{
      ...personWith(null, 'NORMAL'),
      tracking: { boundingBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.6 } },
    }];
    const response = await frameAI(frameRequest(monitor, callId), context(callId));
    const body = (await response.json()).data;
    expect(response.status).toBe(200);
    expect(calls.filter(url => url.includes('/sessions/start'))).toHaveLength(1);
    expect(calls.filter(url => url.includes('/frames'))).toHaveLength(2);
    expect(body.overlay).toHaveLength(1);
  });

  it('does not persist or expose impairment output without the entitlement', async () => {
    await prisma.divisionAIEntitlement.update({
      where: { divisionId },
      data: { impairmentDetection: false },
    });
    await sendFrame([personWith(EPISODE, 'ELEVATED_INDICATORS')]);
    expect(await prisma.safetyEvent.count()).toBe(0);

    const status = await statusAI(
      requestFor(monitor, `/api/monitoring/calls/${callId}/ai/status`, 'GET'),
      context(callId),
    );
    const person = (await status.json()).data.people.persons[0];
    expect(person.trackId).toBe('Person-1');
    expect(person.impairment).toBeUndefined();
    expect(person.visualStatus).toBeUndefined();
  });
});
