import { POST as loginPost } from '@/app/api/auth/login/route';
import { GET as listDivisions, POST as createDivision } from '@/app/api/admin/divisions/route';
import { GET as getDivision } from '@/app/api/admin/divisions/[id]/route';
import { GET as getLobby } from '@/app/api/admin/lobbies/[id]/route';
import { POST as createLobby } from '@/app/api/admin/lobbies/route';
import { GET as listUsers, POST as createUser } from '@/app/api/admin/users/route';
import { PATCH as updateUser } from '@/app/api/admin/users/[id]/route';
import { GET as listZones, POST as createZone } from '@/app/api/admin/zones/route';
import { toSessionClaims } from '@/lib/rmo/session-claims';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/utils';
import { NextRequest } from 'next/server';
import { cleanupDatabase, testPrisma } from '../../setup';

jest.mock('@/lib/auth/jwt', () => ({
  generateJWT: jest.fn(async () => 'test-token'),
  setAuthCookie: jest.fn(),
  JWT_KEY: 'auth-token',
  getAuthUser: jest.fn(async (request: { headers: { get: (name: string) => string | null } }) => {
    const raw = request.headers.get('x-test-user');
    return raw ? JSON.parse(raw) : null;
  }),
}));

jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({
    set: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
  })),
}));

const PASSWORD = 'TestPassword123!';

async function requestFor(
  user: Parameters<typeof toSessionClaims>[0] | null,
  path: string,
  method: string,
  body?: unknown,
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (user) {
    headers.set('x-test-user', JSON.stringify(toSessionClaims(user)));
  }
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createAccount(input: {
  email: string;
  loginId: string;
  rmoRole:
    | 'SYSTEM_ADMIN'
    | 'SUPER_ADMIN'
    | 'DIVISION_ADMIN'
    | 'DIVISION_MONITOR'
    | 'LOBBY_USER'
    | 'CREW_USER';
  homeZoneId?: number;
  homeDivisionId?: number;
  homeLobbyId?: number;
  accountStatus?: 'ACTIVE' | 'DISABLED';
}) {
  return testPrisma.user.create({
    data: {
      email: input.email,
      name: input.loginId,
      loginId: input.loginId,
      password: await hashPassword(PASSWORD),
      role: input.rmoRole === 'SYSTEM_ADMIN' || input.rmoRole === 'SUPER_ADMIN' ? 'ADMIN' : 'USER',
      rmoRole: input.rmoRole,
      accountStatus: input.accountStatus || 'ACTIVE',
      isOnboarded: true,
      homeZoneId: input.homeZoneId,
      homeDivisionId: input.homeDivisionId,
      homeLobbyId: input.homeLobbyId,
    },
  });
}

describe('RMO administration security', () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterAll(async () => {
    await cleanupDatabase();
    await testPrisma.$disconnect();
    await prisma.$disconnect();
  });

  it('signs in an active user and rejects a disabled user', async () => {
    await createAccount({
      email: 'active@example.com',
      loginId: 'active-user',
      rmoRole: 'SYSTEM_ADMIN',
    });
    await createAccount({
      email: 'disabled@example.com',
      loginId: 'disabled-user',
      rmoRole: 'CREW_USER',
      accountStatus: 'DISABLED',
    });

    const success = await loginPost(
      await requestFor(null, '/api/auth/login', 'POST', {
        identifier: 'active-user',
        password: PASSWORD,
      }),
    );
    const successBody = await success.json();
    expect(success.status).toBe(200);
    expect(successBody.data.user.rmoRole).toBe('SYSTEM_ADMIN');
    expect(successBody.data.user.password).toBeUndefined();
    expect(successBody.data.token).toBeUndefined();

    const denied = await loginPost(
      await requestFor(null, '/api/auth/login', 'POST', {
        email: 'disabled@example.com',
        password: PASSWORD,
      }),
    );
    expect(denied.status).toBe(401);

    const invalid = await loginPost(
      await requestFor(null, '/api/auth/login', 'POST', {
        email: 'active@example.com',
        password: 'WrongPassword123!',
      }),
    );
    expect(invalid.status).toBe(400);
  });

  it('requires authentication and blocks privilege escalation', async () => {
    const anonymous = await listZones(await requestFor(null, '/api/admin/zones', 'GET'));
    expect(anonymous.status).toBe(401);

    const lobby = await createAccount({
      email: 'lobby@example.com',
      loginId: 'lobby-user',
      rmoRole: 'LOBBY_USER',
    });
    const escalated = await createUser(
      await requestFor(lobby, '/api/admin/users', 'POST', {
        name: 'Hacker',
        email: 'hacker@example.com',
        loginId: 'hacker',
        password: PASSWORD,
        rmoRole: 'SYSTEM_ADMIN',
      }),
    );
    expect(escalated.status).toBe(403);

    const crew = await createAccount({
      email: 'crew@example.com',
      loginId: 'crew-user',
      rmoRole: 'CREW_USER',
    });
    const crewUsers = await listUsers(await requestFor(crew, '/api/admin/users', 'GET'));
    expect(crewUsers.status).toBe(403);
  });

  it('creates a consistent hierarchy and rejects a broken one', async () => {
    const admin = await createAccount({
      email: 'admin@example.com',
      loginId: 'admin-user',
      rmoRole: 'SYSTEM_ADMIN',
    });
    const zoneResponse = await createZone(
      await requestFor(admin, '/api/admin/zones', 'POST', { name: 'Western', code: 'WEST' }),
    );
    expect(zoneResponse.status).toBe(201);
    const zone = (await zoneResponse.json()).data;

    const duplicate = await createZone(
      await requestFor(admin, '/api/admin/zones', 'POST', { name: 'Other', code: 'WEST' }),
    );
    expect(duplicate.status).toBe(400);

    const divisionResponse = await createDivision(
      await requestFor(admin, '/api/admin/divisions', 'POST', {
        zoneId: zone.id,
        name: 'Ahmedabad',
        code: 'ADI',
      }),
    );
    expect(divisionResponse.status).toBe(201);
    const division = (await divisionResponse.json()).data;

    const broken = await createDivision(
      await requestFor(admin, '/api/admin/divisions', 'POST', {
        zoneId: 99999,
        name: 'Missing',
        code: 'MISS',
      }),
    );
    expect(broken.status).toBe(400);

    const lobbyResponse = await createLobby(
      await requestFor(admin, '/api/admin/lobbies', 'POST', {
        divisionId: division.id,
        name: 'Platform',
        code: 'PF1',
      }),
    );
    expect(lobbyResponse.status).toBe(201);
    const lobby = (await lobbyResponse.json()).data;

    const created = await createUser(
      await requestFor(admin, '/api/admin/users', 'POST', {
        name: 'Crew One',
        email: 'crew-one@example.com',
        loginId: 'crew-one',
        password: PASSWORD,
        rmoRole: 'CREW_USER',
        homeZoneId: zone.id,
        homeDivisionId: division.id,
        homeLobbyId: lobby.id,
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.data.password).toBeUndefined();

    const mismatched = await createUser(
      await requestFor(admin, '/api/admin/users', 'POST', {
        name: 'Bad Crew',
        email: 'bad-crew@example.com',
        loginId: 'bad-crew',
        password: PASSWORD,
        rmoRole: 'CREW_USER',
        homeZoneId: zone.id,
        homeDivisionId: division.id,
        homeLobbyId: 99999,
      }),
    );
    expect(mismatched.status).toBe(400);

    const selfRole = await updateUser(
      await requestFor(admin, `/api/admin/users/${admin.id}`, 'PATCH', { rmoRole: 'CREW_USER' }),
      { params: Promise.resolve({ id: String(admin.id) }) },
    );
    expect(selfRole.status).toBe(403);
  });

  it('stops a division admin from another division and from system administration', async () => {
    const admin = await createAccount({
      email: 'root@example.com',
      loginId: 'root-admin',
      rmoRole: 'SYSTEM_ADMIN',
    });
    const zone = (
      await (
        await createZone(
          await requestFor(admin, '/api/admin/zones', 'POST', { name: 'West', code: 'W' }),
        )
      ).json()
    ).data;
    const ahmedabad = (
      await (
        await createDivision(
          await requestFor(admin, '/api/admin/divisions', 'POST', {
            zoneId: zone.id,
            name: 'Ahmedabad',
            code: 'ADI',
          }),
        )
      ).json()
    ).data;
    const surat = (
      await (
        await createDivision(
          await requestFor(admin, '/api/admin/divisions', 'POST', {
            zoneId: zone.id,
            name: 'Surat',
            code: 'ST',
          }),
        )
      ).json()
    ).data;
    const divisionAdmin = await createAccount({
      email: 'div@example.com',
      loginId: 'div-admin',
      rmoRole: 'DIVISION_ADMIN',
      homeZoneId: zone.id,
      homeDivisionId: ahmedabad.id,
    });

    const own = await getDivision(
      await requestFor(divisionAdmin, `/api/admin/divisions/${ahmedabad.id}`, 'GET'),
      { params: Promise.resolve({ id: String(ahmedabad.id) }) },
    );
    expect(own.status).toBe(200);

    const other = await getDivision(
      await requestFor(divisionAdmin, `/api/admin/divisions/${surat.id}`, 'GET'),
      { params: Promise.resolve({ id: String(surat.id) }) },
    );
    expect(other.status).toBe(403);

    const listed = await listDivisions(
      await requestFor(divisionAdmin, '/api/admin/divisions', 'GET'),
    );
    const listedBody = await listed.json();
    expect(listed.status).toBe(200);
    expect(listedBody.data.items).toHaveLength(1);
    expect(listedBody.data.items[0].id).toBe(ahmedabad.id);

    const zones = await listZones(await requestFor(divisionAdmin, '/api/admin/zones', 'GET'));
    expect(zones.status).toBe(403);

    const promote = await createUser(
      await requestFor(divisionAdmin, '/api/admin/users', 'POST', {
        name: 'New Admin',
        email: 'new-admin@example.com',
        loginId: 'new-admin',
        password: PASSWORD,
        rmoRole: 'SYSTEM_ADMIN',
      }),
    );
    expect(promote.status).toBe(403);

    const vatva = (
      await (
        await createLobby(
          await requestFor(admin, '/api/admin/lobbies', 'POST', {
            divisionId: ahmedabad.id,
            name: 'Vatva',
            code: 'VATVA',
          }),
        )
      ).json()
    ).data;
    const crewInDivision = await createUser(
      await requestFor(divisionAdmin, '/api/admin/users', 'POST', {
        name: 'Ahmedabad Crew',
        email: 'adi-crew@example.com',
        loginId: 'adi-crew',
        password: PASSWORD,
        rmoRole: 'CREW_USER',
        homeZoneId: zone.id,
        homeDivisionId: ahmedabad.id,
        homeLobbyId: vatva.id,
      }),
    );
    expect(crewInDivision.status).toBe(201);

    const outside = await createUser(
      await requestFor(divisionAdmin, '/api/admin/users', 'POST', {
        name: 'Surat Crew',
        email: 'surat-crew@example.com',
        loginId: 'surat-crew',
        password: PASSWORD,
        rmoRole: 'CREW_USER',
        homeZoneId: zone.id,
        homeDivisionId: surat.id,
      }),
    );
    expect(outside.status).toBe(403);

    const selfPromote = await updateUser(
      await requestFor(divisionAdmin, `/api/admin/users/${divisionAdmin.id}`, 'PATCH', {
        rmoRole: 'SYSTEM_ADMIN',
      }),
      { params: Promise.resolve({ id: String(divisionAdmin.id) }) },
    );
    expect(selfPromote.status).toBe(403);
  });

  it('refuses organization changes from a super admin', async () => {
    const superAdmin = await createAccount({
      email: 'super@example.com',
      loginId: 'super-admin',
      rmoRole: 'SUPER_ADMIN',
    });
    const response = await createZone(
      await requestFor(superAdmin, '/api/admin/zones', 'POST', { name: 'West', code: 'WEST' }),
    );
    expect(response.status).toBe(403);
  });

  it('stops a lobby user from another lobby', async () => {
    const admin = await createAccount({
      email: 'root2@example.com',
      loginId: 'root-two',
      rmoRole: 'SYSTEM_ADMIN',
    });
    const zone = (
      await (
        await createZone(
          await requestFor(admin, '/api/admin/zones', 'POST', { name: 'North', code: 'N' }),
        )
      ).json()
    ).data;
    const division = (
      await (
        await createDivision(
          await requestFor(admin, '/api/admin/divisions', 'POST', {
            zoneId: zone.id,
            name: 'Division',
            code: 'DV',
          }),
        )
      ).json()
    ).data;
    const ownLobby = (
      await (
        await createLobby(
          await requestFor(admin, '/api/admin/lobbies', 'POST', {
            divisionId: division.id,
            name: 'Vatva',
            code: 'VAT',
          }),
        )
      ).json()
    ).data;
    const otherLobby = (
      await (
        await createLobby(
          await requestFor(admin, '/api/admin/lobbies', 'POST', {
            divisionId: division.id,
            name: 'Maninagar',
            code: 'MAN',
          }),
        )
      ).json()
    ).data;
    const lobbyUser = await createAccount({
      email: 'lobby2@example.com',
      loginId: 'lobby-two',
      rmoRole: 'LOBBY_USER',
      homeZoneId: zone.id,
      homeDivisionId: division.id,
      homeLobbyId: ownLobby.id,
    });

    const allowed = await getLobby(
      await requestFor(lobbyUser, `/api/admin/lobbies/${ownLobby.id}`, 'GET'),
      { params: Promise.resolve({ id: String(ownLobby.id) }) },
    );
    expect(allowed.status).toBe(200);

    const blocked = await getLobby(
      await requestFor(lobbyUser, `/api/admin/lobbies/${otherLobby.id}`, 'GET'),
      { params: Promise.resolve({ id: String(otherLobby.id) }) },
    );
    expect(blocked.status).toBe(403);

    const moved = await updateUser(
      await requestFor(lobbyUser, `/api/admin/users/${lobbyUser.id}`, 'PATCH', {
        homeLobbyId: otherLobby.id,
      }),
      { params: Promise.resolve({ id: String(lobbyUser.id) }) },
    );
    expect(moved.status).toBe(403);

    const crew = await createAccount({
      email: 'crew-scope@example.com',
      loginId: 'crew-scope',
      rmoRole: 'CREW_USER',
      homeZoneId: zone.id,
      homeDivisionId: division.id,
      homeLobbyId: ownLobby.id,
    });
    const crewRole = await updateUser(
      await requestFor(crew, `/api/admin/users/${crew.id}`, 'PATCH', { rmoRole: 'SYSTEM_ADMIN' }),
      { params: Promise.resolve({ id: String(crew.id) }) },
    );
    expect(crewRole.status).toBe(403);

    const monitor = await createAccount({
      email: 'monitor@example.com',
      loginId: 'division-monitor',
      rmoRole: 'DIVISION_MONITOR',
      homeZoneId: zone.id,
      homeDivisionId: division.id,
    });
    const monitorUsers = await listUsers(await requestFor(monitor, '/api/admin/users', 'GET'));
    expect(monitorUsers.status).toBe(403);
  });
});
