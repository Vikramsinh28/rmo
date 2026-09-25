import { GET as getFace, POST as postFace } from '@/app/api/crew/face-enrollment/route';
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
  accountStatus?: 'ACTIVE' | 'DISABLED';
}) {
  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      loginId: input.loginId,
      password: await hashPassword('TestPassword123!'),
      role: input.rmoRole === 'SYSTEM_ADMIN' ? 'ADMIN' : 'USER',
      rmoRole: input.rmoRole,
      accountStatus: input.accountStatus || 'ACTIVE',
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
  contentType?: string,
) {
  const headers = new Headers();
  if (contentType) headers.set('content-type', contentType);
  if (user) headers.set('x-test-user', JSON.stringify(toSessionClaims(user)));
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : body,
  });
}

function jpegSample(tag = 'ok') {
  const payload = Buffer.alloc(2500, 0x41);
  payload.write(tag, 100, 'utf8');
  return Buffer.concat([Buffer.from([0xff, 0xd8]), payload, Buffer.from([0xff, 0xd9])]);
}

async function formWithSamples(samples: Buffer[], confirmReenroll = false) {
  const form = new FormData();
  samples.forEach((sample, index) => {
    const bytes = new Uint8Array(sample);
    form.append(`sample${index}`, new Blob([bytes], { type: 'image/jpeg' }), `s${index}.jpg`);
  });
  if (confirmReenroll) form.append('confirmReenroll', 'true');
  return form;
}

describe('Crew face enrollment', () => {
  let system: Awaited<ReturnType<typeof userWith>>;
  let admin: Awaited<ReturnType<typeof userWith>>;
  let monitor: Awaited<ReturnType<typeof userWith>>;
  let lobbyUser: Awaited<ReturnType<typeof userWith>>;
  let crew: Awaited<ReturnType<typeof userWith>>;
  let otherCrew: Awaited<ReturnType<typeof userWith>>;
  let ahmedabad: { id: number };
  let lobby: { id: number };

  beforeEach(async () => {
    await cleanupDatabase();
    process.env.FACE_ENROLLMENT_PROVIDER = 'mock';

    const zone = await prisma.zone.create({
      data: { name: 'West', code: `W-${Date.now()}`, status: 'ACTIVE' },
    });
    ahmedabad = await prisma.division.create({
      data: { name: 'Ahmedabad', code: `ADI-${Date.now()}`, status: 'ACTIVE', zoneId: zone.id },
    });
    lobby = await prisma.lobby.create({
      data: {
        name: 'Vatva',
        code: `V-${Date.now()}`,
        status: 'ACTIVE',
        divisionId: ahmedabad.id,
      },
    });

    system = await userWith({
      name: 'System',
      email: `sys-${Date.now()}@local`,
      loginId: `sys-${Date.now()}`,
      rmoRole: 'SYSTEM_ADMIN',
    });
    admin = await userWith({
      name: 'Admin',
      email: `admin-${Date.now()}@local`,
      loginId: `admin-${Date.now()}`,
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
    otherCrew = await userWith({
      name: 'Other',
      email: `ocrew-${Date.now()}@local`,
      loginId: `ocrew-${Date.now()}`,
      rmoRole: 'CREW_USER',
      homeZoneId: zone.id,
      homeDivisionId: ahmedabad.id,
      homeLobbyId: lobby.id,
    });
  });

  afterAll(async () => {
    delete process.env.FACE_ENROLLMENT_PROVIDER;
    await cleanupDatabase();
    await prisma.$disconnect();
  });

  async function enableFace() {
    await prisma.divisionAIEntitlement.create({
      data: {
        divisionId: ahmedabad.id,
        enabled: true,
        plan: 'PREMIUM',
        status: 'ACTIVE',
        faceIdentification: true,
      },
    });
  }

  it('rejects anonymous and non-crew roles', async () => {
    const anon = await getFace(await requestFor(null, '/api/crew/face-enrollment', 'GET'));
    expect(anon.status).toBe(401);

    for (const actor of [system, admin, monitor, lobbyUser]) {
      const denied = await getFace(await requestFor(actor, '/api/crew/face-enrollment', 'GET'));
      expect(denied.status).toBe(403);
    }
  });

  it('blocks enrollment without face identification entitlement', async () => {
    const denied = await postFace(
      await requestFor(
        crew,
        '/api/crew/face-enrollment',
        'POST',
        await formWithSamples([jpegSample(), jpegSample(), jpegSample()]),
      ),
    );
    const body = await denied.json();
    expect(denied.status).toBe(403);
    expect(body.error).toBe('FACE_IDENTIFICATION_NOT_ENABLED');
  });

  it('enrolls with mock provider and requires confirmation to re-enroll', async () => {
    await enableFace();
    const empty = await postFace(
      await requestFor(crew, '/api/crew/face-enrollment', 'POST', await formWithSamples([])),
    );
    expect(empty.status).toBe(400);

    const oversized = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(1_600_000), Buffer.from([0xff, 0xd9])]);
    const tooBig = await postFace(
      await requestFor(
        crew,
        '/api/crew/face-enrollment',
        'POST',
        await formWithSamples([oversized, jpegSample(), jpegSample()]),
      ),
    );
    expect(tooBig.status).toBe(413);

    const ok = await postFace(
      await requestFor(
        crew,
        '/api/crew/face-enrollment',
        'POST',
        await formWithSamples([jpegSample('a'), jpegSample('b'), jpegSample('c')]),
      ),
    );
    const okBody = await ok.json();
    expect(ok.status).toBe(200);
    expect(okBody.data.status).toBe('ENROLLED');
    expect(okBody.data.providerFaceId).toBeUndefined();
    expect(JSON.stringify(okBody)).not.toMatch(/secretAccessKey|AWS_SECRET|password/i);

    const row = await prisma.userFaceEnrollment.findFirst({ where: { userId: crew.id } });
    expect(row?.providerFaceId).toBeTruthy();
    expect(row?.collectionId).toBe(`rmo-local-division-${ahmedabad.id}`);

    const duplicate = await postFace(
      await requestFor(
        crew,
        '/api/crew/face-enrollment',
        'POST',
        await formWithSamples([jpegSample(), jpegSample(), jpegSample()]),
      ),
    );
    expect(duplicate.status).toBe(409);

    const reenroll = await postFace(
      await requestFor(
        crew,
        '/api/crew/face-enrollment',
        'POST',
        await formWithSamples([jpegSample('d'), jpegSample('e'), jpegSample('f')], true),
      ),
    );
    expect(reenroll.status).toBe(200);
    expect((await reenroll.json()).data.status).toBe('ENROLLED');

    const other = await getFace(await requestFor(otherCrew, '/api/crew/face-enrollment', 'GET'));
    expect(other.status).toBe(200);
    expect((await other.json()).data.status).toBe('NOT_ENROLLED');
  });

  it('rejects no-face samples from the mock provider', async () => {
    await enableFace();
    const tiny = Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]);
    const failed = await postFace(
      await requestFor(
        crew,
        '/api/crew/face-enrollment',
        'POST',
        await formWithSamples([tiny, tiny, tiny]),
      ),
    );
    expect([400, 422]).toContain(failed.status);
  });
});
