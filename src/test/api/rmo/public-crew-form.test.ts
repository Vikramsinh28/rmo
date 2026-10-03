import { GET as getPublicLobby } from '@/app/api/public/crew-form/[token]/route';
import { POST as identifyPublic } from '@/app/api/public/crew-form/[token]/identify/route';
import { GET as publicDutyTypes } from '@/app/api/public/crew-form/session/[sessionToken]/duty-types/route';
import { GET as publicForm } from '@/app/api/public/crew-form/session/[sessionToken]/form/route';
import { POST as publicSubmit } from '@/app/api/public/crew-form/session/[sessionToken]/submit/route';
import { GET as listLobbyQr } from '@/app/api/lobbies/qr/route';
import { GET as analyticsSubmissions } from '@/app/api/analytics/submissions/route';
import { GET as exportSubmissions } from '@/app/api/submissions/export/route';
import { POST as createSubmission } from '@/app/api/submissions/route';
import { prisma } from '@/lib/prisma';
import { generateLobbyPublicToken } from '@/lib/rmo/public-crew-form';
import { resetRateLimits } from '@/lib/rmo/rate-limit';
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

const schema = {
  sections: ['Duty'],
  fields: [
    {
      id: 'confirm_ready',
      key: 'confirm_ready',
      label: 'Confirm ready',
      type: 'YES_NO',
      required: true,
      placeholder: '',
      helpText: '',
      options: [],
      validation: {},
      displayOrder: 0,
      section: 'Duty',
    },
  ],
};

async function requestFor(
  user: Parameters<typeof toSessionClaims>[0] | null,
  path: string,
  method: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
) {
  const headers = new Headers({ 'content-type': 'application/json', ...(extraHeaders || {}) });
  if (user) headers.set('x-test-user', JSON.stringify(toSessionClaims(user)));
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function tokenContext(token: string) {
  return { params: Promise.resolve({ token }) };
}

function sessionContext(sessionToken: string) {
  return { params: Promise.resolve({ sessionToken }) };
}

async function jsonOf(response: Response) {
  return response.json() as Promise<{ success: boolean; message?: string; data?: any }>;
}

describe('Public crew form / lobby QR', () => {
  beforeEach(async () => {
    await cleanupDatabase();
    resetRateLimits();
  });

  afterAll(async () => {
    await cleanupDatabase();
    await testPrisma.$disconnect();
    await prisma.$disconnect();
  });

  async function world() {
    const password = await hashPassword(PASSWORD);
    const admin = await testPrisma.user.create({
      data: {
        email: 'root@example.com',
        name: 'Root',
        loginId: 'root',
        password,
        rmoRole: 'SYSTEM_ADMIN',
        accountStatus: 'ACTIVE',
        role: 'ADMIN',
        isOnboarded: true,
      },
    });
    const zone = await testPrisma.zone.create({
      data: { name: 'Western', code: 'WR', status: 'ACTIVE' },
    });
    const division = await testPrisma.division.create({
      data: { zoneId: zone.id, name: 'Ahmedabad', code: 'ADI', status: 'ACTIVE' },
    });
    const otherDivision = await testPrisma.division.create({
      data: { zoneId: zone.id, name: 'Bhavnagar', code: 'BVC', status: 'ACTIVE' },
    });
    const lobby = await testPrisma.lobby.create({
      data: {
        divisionId: division.id,
        name: 'Botad',
        code: 'BTD',
        status: 'ACTIVE',
        publicToken: generateLobbyPublicToken(),
      },
    });
    const otherLobby = await testPrisma.lobby.create({
      data: {
        divisionId: otherDivision.id,
        name: 'Other',
        code: 'OTH',
        status: 'ACTIVE',
        publicToken: generateLobbyPublicToken(),
      },
    });
    const alp = await testPrisma.crewType.create({
      data: { code: 'ALP', name: 'ALP', isActive: true, sortOrder: 1 },
    });
    const lp = await testPrisma.crewType.create({
      data: { code: 'LP', name: 'LP', isActive: true, sortOrder: 2 },
    });
    const signOn = await testPrisma.dutyType.create({
      data: { code: 'SIGN_ON', name: 'Sign On', isActive: true, sortOrder: 1 },
    });
    const signOff = await testPrisma.dutyType.create({
      data: { code: 'SIGN_OFF', name: 'Sign Off', isActive: true, sortOrder: 2 },
    });

    const alpCrew = await testPrisma.user.create({
      data: {
        email: 'john.doe@example.com',
        name: 'John Doe',
        loginId: 'ABC123',
        password,
        rmoRole: 'CREW_USER',
        accountStatus: 'ACTIVE',
        role: 'USER',
        isOnboarded: true,
        homeZoneId: zone.id,
        homeDivisionId: division.id,
        homeLobbyId: lobby.id,
        crewTypeId: alp.id,
      },
    });
    const lpCrew = await testPrisma.user.create({
      data: {
        email: 'lp.user@example.com',
        name: 'LP User',
        loginId: 'LP001',
        password,
        rmoRole: 'CREW_USER',
        accountStatus: 'ACTIVE',
        role: 'USER',
        isOnboarded: true,
        homeZoneId: zone.id,
        homeDivisionId: division.id,
        homeLobbyId: lobby.id,
        crewTypeId: lp.id,
      },
    });
    const inactive = await testPrisma.user.create({
      data: {
        email: 'inactive@example.com',
        name: 'Inactive',
        loginId: 'INACT1',
        password,
        rmoRole: 'CREW_USER',
        accountStatus: 'DISABLED',
        role: 'USER',
        isOnboarded: true,
        homeZoneId: zone.id,
        homeDivisionId: division.id,
        homeLobbyId: lobby.id,
        crewTypeId: alp.id,
      },
    });
    const lobbyUser = await testPrisma.user.create({
      data: {
        email: 'lobby@example.com',
        name: 'Lobby Desk',
        loginId: 'LOBBY1',
        password,
        rmoRole: 'LOBBY_USER',
        accountStatus: 'ACTIVE',
        role: 'USER',
        isOnboarded: true,
        homeZoneId: zone.id,
        homeDivisionId: division.id,
        homeLobbyId: lobby.id,
      },
    });

    async function publishCrewForm(name: string, crewTypeId: number, dutyTypeId: number) {
      const form = await testPrisma.form.create({
        data: {
          name,
          description: '',
          divisionId: division.id,
          crewTypeId,
          dutyTypeId,
          status: 'DRAFT',
          purpose: 'GENERAL',
          createdById: admin.id,
        },
      });
      const version = await testPrisma.formVersion.create({
        data: {
          formId: form.id,
          versionNumber: 1,
          schema,
          status: 'PUBLISHED',
          createdById: admin.id,
        },
      });
      return testPrisma.form.update({
        where: { id: form.id },
        data: { status: 'PUBLISHED', currentVersionId: version.id },
      });
    }

    const alpSignOn = await publishCrewForm('ALP Sign On Form', alp.id, signOn.id);
    const alpSignOff = await publishCrewForm('ALP Sign Off Form', alp.id, signOff.id);
    const lpSignOn = await publishCrewForm('LP Sign On Form', lp.id, signOn.id);
    const draft = await testPrisma.form.create({
      data: {
        name: 'Draft ALP Sign On',
        divisionId: division.id,
        crewTypeId: alp.id,
        dutyTypeId: signOn.id,
        status: 'DRAFT',
        purpose: 'GENERAL',
        createdById: admin.id,
      },
    });

    return {
      admin,
      lobbyUser,
      alpCrew,
      lpCrew,
      inactive,
      lobby,
      otherLobby,
      division,
      alp,
      lp,
      signOn,
      signOff,
      alpSignOn,
      alpSignOff,
      lpSignOn,
      draft,
    };
  }

  it('resolves a valid lobby QR and rejects invalid/revoked tokens', async () => {
    const { lobby } = await world();
    const ok = await jsonOf(
      await getPublicLobby(await requestFor(null, `/api/public/crew-form/${lobby.publicToken}`, 'GET'), tokenContext(lobby.publicToken!)),
    );
    expect(ok.success).toBe(true);
    expect(ok.data.lobbyName).toBe('Botad');
    expect(ok.data.divisionName).toBe('Ahmedabad');
    expect(JSON.stringify(ok.data)).not.toMatch(/"id":/);

    const bad = await jsonOf(
      await getPublicLobby(await requestFor(null, '/api/public/crew-form/RMO-LBY-missing', 'GET'), tokenContext('RMO-LBY-missing')),
    );
    expect(bad.success).toBe(false);

    await testPrisma.lobby.update({
      where: { id: lobby.id },
      data: { publicTokenRevokedAt: new Date() },
    });
    const revoked = await jsonOf(
      await getPublicLobby(await requestFor(null, `/api/public/crew-form/${lobby.publicToken}`, 'GET'), tokenContext(lobby.publicToken!)),
    );
    expect(revoked.success).toBe(false);
  });

  it('identifies crew with email/staff normalization and rejects mismatches', async () => {
    const { lobby, alpCrew, inactive, otherLobby, signOn } = await world();
    const ok = await jsonOf(
      await identifyPublic(
        await requestFor(null, `/api/public/crew-form/${lobby.publicToken}/identify`, 'POST', {
          staffNumber: '  abc123 ',
          email: 'John.Doe@Example.COM',
        }),
        tokenContext(lobby.publicToken!),
      ),
    );
    expect(ok.success).toBe(true);
    expect(ok.data.crew.name).toBe('John Doe');
    expect(ok.data.crew.crewType.code).toBe('ALP');
    expect(ok.data.publicSessionToken).toBeTruthy();
    expect(JSON.stringify(ok.data)).not.toContain(String(alpCrew.id));

    const wrongEmail = await jsonOf(
      await identifyPublic(
        await requestFor(null, `/api/public/crew-form/${lobby.publicToken}/identify`, 'POST', {
          staffNumber: 'ABC123',
          email: 'wrong@example.com',
        }),
        tokenContext(lobby.publicToken!),
      ),
    );
    expect(wrongEmail.success).toBe(false);
    expect(wrongEmail.message).toMatch(/could not verify/i);

    const wrongStaff = await jsonOf(
      await identifyPublic(
        await requestFor(null, `/api/public/crew-form/${lobby.publicToken}/identify`, 'POST', {
          staffNumber: 'WRONG',
          email: 'john.doe@example.com',
        }),
        tokenContext(lobby.publicToken!),
      ),
    );
    expect(wrongStaff.success).toBe(false);

    const inactiveRes = await jsonOf(
      await identifyPublic(
        await requestFor(null, `/api/public/crew-form/${lobby.publicToken}/identify`, 'POST', {
          staffNumber: 'INACT1',
          email: 'inactive@example.com',
        }),
        tokenContext(lobby.publicToken!),
      ),
    );
    expect(inactiveRes.success).toBe(false);
    void inactive;

    const crossLobby = await jsonOf(
      await identifyPublic(
        await requestFor(null, `/api/public/crew-form/${otherLobby.publicToken}/identify`, 'POST', {
          staffNumber: 'ABC123',
          email: 'john.doe@example.com',
        }),
        tokenContext(otherLobby.publicToken!),
      ),
    );
    expect(crossLobby.success).toBe(false);
    void signOn;
  });

  it('loads ALP form only, rejects overrides, submits PUBLIC_QR, and blocks same-day duplicates', async () => {
    const { lobby, alpCrew, signOn, lpSignOn, admin } = await world();
    const identified = await jsonOf(
      await identifyPublic(
        await requestFor(null, `/api/public/crew-form/${lobby.publicToken}/identify`, 'POST', {
          staffNumber: 'ABC123',
          email: 'john.doe@example.com',
        }),
        tokenContext(lobby.publicToken!),
      ),
    );
    const session = identified.data.publicSessionToken as string;

    const duties = await jsonOf(
      await publicDutyTypes(
        await requestFor(null, `/api/public/crew-form/session/${session}/duty-types`, 'GET'),
        sessionContext(session),
      ),
    );
    expect(duties.data.items.some((d: any) => d.code === 'SIGN_ON')).toBe(true);

    const form = await jsonOf(
      await publicForm(
        await requestFor(
          null,
          `/api/public/crew-form/session/${session}/form?dutyTypeId=${signOn.id}`,
          'GET',
        ),
        sessionContext(session),
      ),
    );
    expect(form.success).toBe(true);
    expect(form.data.form.name).toBe('ALP Sign On Form');
    expect(form.data.form.crewType.code).toBe('ALP');

    const wrongForm = await jsonOf(
      await publicSubmit(
        await requestFor(null, `/api/public/crew-form/session/${session}/submit`, 'POST', {
          dutyTypeId: signOn.id,
          formId: lpSignOn.id,
          answers: { confirm_ready: true },
          userId: 999,
          divisionId: 999,
          lobbyId: 999,
          crewTypeId: 999,
        }),
        sessionContext(session),
      ),
    );
    expect(wrongForm.success).toBe(false);

    const submitted = await jsonOf(
      await publicSubmit(
        await requestFor(null, `/api/public/crew-form/session/${session}/submit`, 'POST', {
          dutyTypeId: signOn.id,
          answers: { confirm_ready: true },
        }),
        sessionContext(session),
      ),
    );
    expect(submitted.success).toBe(true);
    expect(submitted.data.reference).toMatch(/^RMO-FRM-/);

    const row = await testPrisma.submission.findFirst({
      where: { submittedById: alpCrew.id, source: 'PUBLIC_QR' },
    });
    expect(row?.source).toBe('PUBLIC_QR');
    expect(row?.lobbyId).toBe(lobby.id);
    expect(row?.crewTypeId).toBe(alpCrew.crewTypeId);
    expect(row?.dutyTypeId).toBe(signOn.id);

    const duplicate = await jsonOf(
      await publicSubmit(
        await requestFor(null, `/api/public/crew-form/session/${session}/submit`, 'POST', {
          dutyTypeId: signOn.id,
          answers: { confirm_ready: true },
        }),
        sessionContext(session),
      ),
    );
    expect(duplicate.success).toBe(false);
    expect(duplicate.message).toMatch(/already been submitted/i);

    const analytics = await jsonOf(
      await analyticsSubmissions(
        await requestFor(admin, '/api/analytics/submissions?source=PUBLIC_QR', 'GET'),
      ),
    );
    expect(analytics.success).toBe(true);
    expect(analytics.data.metrics.total).toBeGreaterThanOrEqual(1);
    expect(analytics.data.source.some((s: any) => s.source === 'PUBLIC_QR')).toBe(true);

    const csv = await exportSubmissions(
      await requestFor(admin, '/api/submissions/export?source=PUBLIC_QR', 'GET'),
    );
    const text = await csv.text();
    expect(text).toContain('submissionSource');
    expect(text).toContain('PUBLIC_QR');
  });

  it('keeps authenticated submissions marked AUTHENTICATED', async () => {
    const { alpCrew, alpSignOn, signOn } = await world();
    const created = await jsonOf(
      await createSubmission(
        await requestFor(alpCrew, '/api/submissions', 'POST', {
          formId: alpSignOn.id,
          dutyTypeId: signOn.id,
          answers: { confirm_ready: true },
        }),
      ),
    );
    expect(created.success).toBe(true);
    const row = await testPrisma.submission.findUnique({ where: { id: created.data.id } });
    expect(row?.source).toBe('AUTHENTICATED');
  });

  it('lists lobby QR for authorized lobby users without exposing raw DB ids in public URL path beyond token', async () => {
    const { lobbyUser, lobby } = await world();
    const listed = await jsonOf(await listLobbyQr(await requestFor(lobbyUser, '/api/lobbies/qr', 'GET')));
    expect(listed.success).toBe(true);
    expect(listed.data.items).toHaveLength(1);
    expect(listed.data.items[0].publicPath).toContain(lobby.publicToken);
    expect(listed.data.items[0].publicPath).not.toContain(`/lobbies/${lobby.id}/`);
  });
});
