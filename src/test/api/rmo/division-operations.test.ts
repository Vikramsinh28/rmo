import { POST as createDevice } from '@/app/api/admin/devices/route';
import { GET as listDevices } from '@/app/api/admin/devices/route';
import { PATCH as updateDevice } from '@/app/api/admin/devices/[id]/route';
import { POST as disableDevice } from '@/app/api/admin/devices/[id]/disable/route';
import { POST as enableDevice } from '@/app/api/admin/devices/[id]/enable/route';
import { POST as createDivision } from '@/app/api/admin/divisions/route';
import { POST as createLobby } from '@/app/api/admin/lobbies/route';
import { GET as getLobby } from '@/app/api/admin/lobbies/[id]/route';
import { GET as listLobbies } from '@/app/api/admin/lobbies/route';
import { POST as resetPassword } from '@/app/api/admin/users/[id]/password/route';
import { GET as getUser, PATCH as updateUser } from '@/app/api/admin/users/[id]/route';
import { GET as listUsers, POST as createUser } from '@/app/api/admin/users/route';
import { POST as createZone } from '@/app/api/admin/zones/route';
import { prisma } from '@/lib/prisma';
import { toSessionClaims } from '@/lib/rmo/session-claims';
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

describe('Division operations', () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterAll(async () => {
    await cleanupDatabase();
    await testPrisma.$disconnect();
    await prisma.$disconnect();
  });

  it('keeps an Ahmedabad division admin inside Ahmedabad users, lobbies, and devices', async () => {
    const admin = await testPrisma.user.create({
      data: {
        email: 'root@example.com',
        name: 'Root',
        loginId: 'root',
        password: await hashPassword(PASSWORD),
        role: 'ADMIN',
        rmoRole: 'SYSTEM_ADMIN',
        isOnboarded: true,
      },
    });
    const zone = (await (await createZone(await requestFor(admin, '/api/admin/zones', 'POST', {
      name: 'West',
      code: 'WEST',
    }))).json()).data;
    const ahmedabad = (await (await createDivision(await requestFor(admin, '/api/admin/divisions', 'POST', {
      zoneId: zone.id,
      name: 'Ahmedabad',
      code: 'ADI',
    }))).json()).data;
    const surat = (await (await createDivision(await requestFor(admin, '/api/admin/divisions', 'POST', {
      zoneId: zone.id,
      name: 'Surat',
      code: 'ST',
    }))).json()).data;
    const vatva = (await (await createLobby(await requestFor(admin, '/api/admin/lobbies', 'POST', {
      divisionId: ahmedabad.id,
      name: 'Vatva',
      code: 'VAT',
    }))).json()).data;
    const suratLobby = (await (await createLobby(await requestFor(admin, '/api/admin/lobbies', 'POST', {
      divisionId: surat.id,
      name: 'Surat Central',
      code: 'STC',
    }))).json()).data;

    const divisionAdmin = await testPrisma.user.create({
      data: {
        email: 'adi-admin@example.com',
        name: 'Ahmedabad Admin',
        loginId: 'adi-admin',
        password: await hashPassword(PASSWORD),
        role: 'USER',
        rmoRole: 'DIVISION_ADMIN',
        isOnboarded: true,
        homeZoneId: zone.id,
        homeDivisionId: ahmedabad.id,
      },
    });
    const suratUser = await testPrisma.user.create({
      data: {
        email: 'surat-user@example.com',
        name: 'Surat User',
        loginId: 'surat-user',
        password: await hashPassword(PASSWORD),
        role: 'USER',
        rmoRole: 'LOBBY_USER',
        isOnboarded: true,
        homeZoneId: zone.id,
        homeDivisionId: surat.id,
        homeLobbyId: suratLobby.id,
      },
    });

    const ownUsers = await listUsers(await requestFor(divisionAdmin, '/api/admin/users', 'GET'));
    expect(ownUsers.status).toBe(200);
    const otherUser = await getUser(
      await requestFor(divisionAdmin, `/api/admin/users/${suratUser.id}`, 'GET'),
      context(suratUser.id),
    );
    expect(otherUser.status).toBe(403);

    const ownLobbies = await listLobbies(await requestFor(divisionAdmin, '/api/admin/lobbies', 'GET'));
    const lobbyBody = await ownLobbies.json();
    expect(lobbyBody.data.items.map((item: { id: number }) => item.id)).toEqual([vatva.id]);
    const otherLobby = await getLobby(
      await requestFor(divisionAdmin, `/api/admin/lobbies/${suratLobby.id}`, 'GET'),
      context(suratLobby.id),
    );
    expect(otherLobby.status).toBe(403);

    const monitor = await createUser(await requestFor(divisionAdmin, '/api/admin/users', 'POST', {
      name: 'Monitor',
      email: 'mon@example.com',
      loginId: 'adi-mon',
      password: PASSWORD,
      rmoRole: 'DIVISION_MONITOR',
      homeZoneId: zone.id,
      homeDivisionId: ahmedabad.id,
    }));
    expect(monitor.status).toBe(201);

    const lobbyUser = await createUser(await requestFor(divisionAdmin, '/api/admin/users', 'POST', {
      name: 'Lobby',
      email: 'lob@example.com',
      loginId: 'adi-lob',
      password: PASSWORD,
      rmoRole: 'LOBBY_USER',
      homeZoneId: zone.id,
      homeDivisionId: ahmedabad.id,
      homeLobbyId: vatva.id,
    }));
    expect(lobbyUser.status).toBe(201);
    const lobbyUserId = (await lobbyUser.json()).data.id;

    const crew = await createUser(await requestFor(divisionAdmin, '/api/admin/users', 'POST', {
      name: 'Crew',
      email: 'crew@example.com',
      loginId: 'adi-crew',
      password: PASSWORD,
      rmoRole: 'CREW_USER',
      homeZoneId: zone.id,
      homeDivisionId: ahmedabad.id,
      homeLobbyId: vatva.id,
    }));
    expect(crew.status).toBe(201);

    for (const role of ['SYSTEM_ADMIN', 'SUPER_ADMIN', 'DIVISION_ADMIN']) {
      const blocked = await createUser(await requestFor(divisionAdmin, '/api/admin/users', 'POST', {
        name: role,
        email: `${role}@example.com`,
        loginId: role.toLowerCase(),
        password: PASSWORD,
        rmoRole: role,
        homeZoneId: zone.id,
        homeDivisionId: ahmedabad.id,
      }));
      expect(blocked.status).toBe(403);
    }

    const suratCreate = await createUser(await requestFor(divisionAdmin, '/api/admin/users', 'POST', {
      name: 'Wrong',
      email: 'wrong@example.com',
      loginId: 'wrong-div',
      password: PASSWORD,
      rmoRole: 'LOBBY_USER',
      homeZoneId: zone.id,
      homeDivisionId: surat.id,
      homeLobbyId: suratLobby.id,
    }));
    expect(suratCreate.status).toBe(403);

    const mixedLobby = await createUser(await requestFor(divisionAdmin, '/api/admin/users', 'POST', {
      name: 'Mixed',
      email: 'mixed@example.com',
      loginId: 'mixed',
      password: PASSWORD,
      rmoRole: 'LOBBY_USER',
      homeZoneId: zone.id,
      homeDivisionId: ahmedabad.id,
      homeLobbyId: suratLobby.id,
    }));
    expect(mixedLobby.status).toBe(403);

    const missingLobby = await createUser(await requestFor(divisionAdmin, '/api/admin/users', 'POST', {
      name: 'No lobby',
      email: 'nolobby@example.com',
      loginId: 'no-lobby',
      password: PASSWORD,
      rmoRole: 'LOBBY_USER',
      homeZoneId: zone.id,
      homeDivisionId: ahmedabad.id,
    }));
    expect(missingLobby.status).toBe(400);

    const monitorLobby = await createUser(await requestFor(divisionAdmin, '/api/admin/users', 'POST', {
      name: 'Monitor lobby',
      email: 'monlob@example.com',
      loginId: 'mon-lob',
      password: PASSWORD,
      rmoRole: 'DIVISION_MONITOR',
      homeZoneId: zone.id,
      homeDivisionId: ahmedabad.id,
      homeLobbyId: vatva.id,
    }));
    expect(monitorLobby.status).toBe(400);

    const moved = await updateUser(
      await requestFor(divisionAdmin, `/api/admin/users/${lobbyUserId}`, 'PATCH', {
        homeDivisionId: surat.id,
        homeLobbyId: suratLobby.id,
      }),
      context(lobbyUserId),
    );
    expect(moved.status).toBe(403);

    const selfRole = await updateUser(
      await requestFor(divisionAdmin, `/api/admin/users/${divisionAdmin.id}`, 'PATCH', {
        rmoRole: 'SYSTEM_ADMIN',
      }),
      context(divisionAdmin.id),
    );
    expect(selfRole.status).toBe(403);

    const resetOwn = await resetPassword(
      await requestFor(divisionAdmin, `/api/admin/users/${lobbyUserId}/password`, 'POST', {
        password: 'NewPassword123!',
      }),
      context(lobbyUserId),
    );
    expect(resetOwn.status).toBe(200);
    const resetOther = await resetPassword(
      await requestFor(divisionAdmin, `/api/admin/users/${suratUser.id}/password`, 'POST', {
        password: 'NewPassword123!',
      }),
      context(suratUser.id),
    );
    expect(resetOther.status).toBe(403);

    const camera = await createDevice(await requestFor(divisionAdmin, '/api/admin/devices', 'POST', {
      name: 'Main Entrance',
      deviceType: 'CAMERA',
      lobbyId: vatva.id,
      streamUrl: 'rtsp://camera.local/entrance',
      displayOrder: 1,
    }));
    expect(camera.status).toBe(201);
    const cameraId = (await camera.json()).data.id;

    const kiosk = await createDevice(await requestFor(divisionAdmin, '/api/admin/devices', 'POST', {
      name: 'Desk 1',
      deviceType: 'KIOSK',
      lobbyId: vatva.id,
      streamUrl: 'rtsp://kiosk.local/desk',
      displayOrder: 2,
    }));
    expect(kiosk.status).toBe(201);

    const edited = await updateDevice(
      await requestFor(divisionAdmin, `/api/admin/devices/${cameraId}`, 'PATCH', {
        name: 'Platform Camera',
      }),
      context(cameraId),
    );
    expect(edited.status).toBe(200);
    expect((await edited.json()).data.name).toBe('Platform Camera');

    const disabled = await disableDevice(
      await requestFor(divisionAdmin, `/api/admin/devices/${cameraId}/disable`, 'POST'),
      context(cameraId),
    );
    expect(disabled.status).toBe(200);
    expect((await disabled.json()).data.isActive).toBe(false);
    const enabled = await enableDevice(
      await requestFor(divisionAdmin, `/api/admin/devices/${cameraId}/enable`, 'POST'),
      context(cameraId),
    );
    expect(enabled.status).toBe(200);

    const suratDevice = await testPrisma.device.create({
      data: {
        name: 'Surat Hall',
        deviceType: 'CAMERA',
        lobbyId: suratLobby.id,
        streamUrl: 'rtsp://surat.local/hall',
      },
    });
    const hidden = await listDevices(await requestFor(divisionAdmin, '/api/admin/devices', 'GET'));
    const names = (await hidden.json()).data.items.map((item: { name: string }) => item.name);
    expect(names).toContain('Platform Camera');
    expect(names).not.toContain('Surat Hall');

    const crossEdit = await updateDevice(
      await requestFor(divisionAdmin, `/api/admin/devices/${suratDevice.id}`, 'PATCH', {
        name: 'Taken',
      }),
      context(suratDevice.id),
    );
    expect(crossEdit.status).toBe(403);

    const crossLobby = await updateDevice(
      await requestFor(divisionAdmin, `/api/admin/devices/${cameraId}`, 'PATCH', {
        lobbyId: suratLobby.id,
      }),
      context(cameraId),
    );
    expect(crossLobby.status).toBe(403);

    const audit = await testPrisma.auditLog.findFirst({
      where: { action: 'device.created', targetId: String(cameraId) },
    });
    expect(audit?.metadata).toEqual(expect.objectContaining({ divisionId: ahmedabad.id }));
    expect(JSON.stringify(audit?.metadata)).not.toContain(PASSWORD);
  });
});
