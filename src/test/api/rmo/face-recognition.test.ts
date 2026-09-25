import { POST as recognize } from '@/app/api/monitoring/calls/[id]/ai/recognize/route';
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

type Role = 'SYSTEM_ADMIN' | 'DIVISION_ADMIN' | 'DIVISION_MONITOR' | 'LOBBY_USER' | 'CREW_USER';

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
  body?: BodyInit | null,
) {
  const headers = new Headers();
  if (user) headers.set('x-test-user', JSON.stringify(toSessionClaims(user)));
  return new NextRequest(`http://localhost${path}`, { method, headers, body: body ?? undefined });
}

function context(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

function jpegWithTag(tag: string) {
  // Null-pad so alphanumeric FACEID captures cannot bleed into filler bytes.
  const payload = Buffer.alloc(2500, 0x00);
  const marked = tag.includes('|') || !tag.startsWith('FACEID:') ? tag : `${tag}|`;
  payload.write(marked, 80, 'utf8');
  return Buffer.concat([Buffer.from([0xff, 0xd8]), payload, Buffer.from([0xff, 0xd9])]);
}

async function frameForm(tag: string) {
  const form = new FormData();
  const bytes = new Uint8Array(jpegWithTag(tag));
  form.append('frame', new Blob([bytes], { type: 'image/jpeg' }), 'frame.jpg');
  return form;
}

describe('Manual face recognition', () => {
  let monitor: Awaited<ReturnType<typeof userWith>>;
  let otherMonitor: Awaited<ReturnType<typeof userWith>>;
  let lobbyUser: Awaited<ReturnType<typeof userWith>>;
  let crew: Awaited<ReturnType<typeof userWith>>;
  let admin: Awaited<ReturnType<typeof userWith>>;
  let ahmedabad: { id: number };
  let surat: { id: number };
  let lobby: { id: number };
  let callId: number;
  let faceId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    process.env.FACE_RECOGNITION_PROVIDER = 'mock';
    process.env.FACE_ENROLLMENT_PROVIDER = 'mock';
    process.env.FACE_RECOGNITION_MATCH_THRESHOLD = '90';
    process.env.FACE_RECOGNITION_COOLDOWN_MS = '60000';

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
        name: 'Vatva',
        code: `V-${Date.now()}`,
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

    monitor = await userWith({
      name: 'Monitor',
      email: `mon-${Date.now()}@local`,
      loginId: `mon-${Date.now()}`,
      rmoRole: 'DIVISION_MONITOR',
      homeZoneId: zone.id,
      homeDivisionId: ahmedabad.id,
    });
    otherMonitor = await userWith({
      name: 'OtherMon',
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
      name: 'Rahul Patel',
      email: `crew-${Date.now()}@local`,
      loginId: `crew-${Date.now()}`,
      rmoRole: 'CREW_USER',
      homeZoneId: zone.id,
      homeDivisionId: ahmedabad.id,
      homeLobbyId: lobby.id,
    });
    admin = await userWith({
      name: 'Admin',
      email: `admin-${Date.now()}@local`,
      loginId: `admin-${Date.now()}`,
      rmoRole: 'DIVISION_ADMIN',
      homeZoneId: zone.id,
      homeDivisionId: ahmedabad.id,
    });

    await prisma.divisionAIEntitlement.create({
      data: {
        divisionId: ahmedabad.id,
        enabled: true,
        plan: 'PREMIUM',
        status: 'ACTIVE',
        faceIdentification: true,
      },
    });
    faceId = `mock-face-rmo-user-${crew.id}`;
    process.env.MOCK_RECOGNITION_FACE_ID = faceId;
    await prisma.divisionFaceCollection.create({
      data: {
        divisionId: ahmedabad.id,
        collectionId: `rmo-local-division-${ahmedabad.id}`,
      },
    });
    await prisma.userFaceEnrollment.create({
      data: {
        userId: crew.id,
        divisionId: ahmedabad.id,
        status: 'ENROLLED',
        provider: 'AWS_REKOGNITION',
        collectionId: `rmo-local-division-${ahmedabad.id}`,
        providerFaceId: faceId,
        enrolledAt: new Date(),
      },
    });

    const dial = await callLobby(
      await requestFor(monitor, `/api/monitoring/lobbies/${lobby.id}/call`, 'POST'),
      context(lobby.id),
    );
    callId = (await dial.json()).data.id;
    await acceptCall(
      await requestFor(lobbyUser, `/api/monitoring/calls/${callId}/accept`, 'POST'),
      context(callId),
    );
  });

  afterAll(async () => {
    delete process.env.FACE_RECOGNITION_PROVIDER;
    delete process.env.FACE_ENROLLMENT_PROVIDER;
    delete process.env.FACE_RECOGNITION_COOLDOWN_MS;
    delete process.env.MOCK_RECOGNITION_FACE_ID;
    await cleanupDatabase();
    await prisma.$disconnect();
  });

  it('rejects unauthorized roles and other divisions', async () => {
    const anon = await recognize(
      await requestFor(null, `/api/monitoring/calls/${callId}/ai/recognize`, 'POST', await frameForm(`FACEID:${faceId}`)),
      context(callId),
    );
    expect(anon.status).toBe(401);

    for (const actor of [lobbyUser, crew, admin]) {
      const denied = await recognize(
        await requestFor(actor, `/api/monitoring/calls/${callId}/ai/recognize`, 'POST', await frameForm(`FACEID:${faceId}`)),
        context(callId),
      );
      expect(denied.status).toBe(403);
    }

    const other = await recognize(
      await requestFor(otherMonitor, `/api/monitoring/calls/${callId}/ai/recognize`, 'POST', await frameForm(`FACEID:${faceId}`)),
      context(callId),
    );
    expect(other.status).toBe(403);
  });

  it('recognizes an enrolled crew member once and rate-limits immediate repeats', async () => {
    const enrollment = await prisma.userFaceEnrollment.findFirst({ where: { userId: crew.id } });
    expect(enrollment?.providerFaceId).toBe(faceId);
    expect(process.env.MOCK_RECOGNITION_FACE_ID).toBe(faceId);

    const first = await recognize(
      await requestFor(monitor, `/api/monitoring/calls/${callId}/ai/recognize`, 'POST', await frameForm(`FACEID:${faceId}`)),
      context(callId),
    );
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(firstBody.data.faces[0]).toMatchObject({
      match: true,
      displayName: 'Rahul Patel',
      userId: crew.id,
    });
    expect(firstBody.data.recognitionRequestCount).toBe(1);
    expect(JSON.stringify(firstBody)).not.toMatch(/providerFaceId|secretAccessKey|FaceMatches/i);

    const second = await recognize(
      await requestFor(monitor, `/api/monitoring/calls/${callId}/ai/recognize`, 'POST', await frameForm(`FACEID:${faceId}`)),
      context(callId),
    );
    expect(second.status).toBe(429);

    const call = await prisma.lobbyCall.findUnique({ where: { id: callId } });
    expect(call?.status).toBe('CONNECTED');
  });

  it('returns unknown for unmatched faces and blocks when entitlement is off', async () => {
    process.env.FACE_RECOGNITION_COOLDOWN_MS = '0';
    delete process.env.MOCK_RECOGNITION_FACE_ID;
    const unknown = await recognize(
      await requestFor(monitor, `/api/monitoring/calls/${callId}/ai/recognize`, 'POST', await frameForm('UNKNOWN')),
      context(callId),
    );
    const unknownBody = await unknown.json();
    expect(unknown.status).toBe(200);
    expect(unknownBody.data.faces[0].match).toBe(false);

    await prisma.divisionAIEntitlement.update({
      where: { divisionId: ahmedabad.id },
      data: { faceIdentification: false },
    });
    const denied = await recognize(
      await requestFor(monitor, `/api/monitoring/calls/${callId}/ai/recognize`, 'POST', await frameForm(`FACEID:${faceId}`)),
      context(callId),
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toBe('FACE_IDENTIFICATION_NOT_ENABLED');
  });
});
