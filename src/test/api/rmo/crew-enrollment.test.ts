import { POST as approveEnrollment } from '@/app/api/admin/crew-enrollments/[id]/approve/route';
import { POST as rejectEnrollment } from '@/app/api/admin/crew-enrollments/[id]/reject/route';
import { GET as getEnrollment } from '@/app/api/admin/crew-enrollments/[id]/route';
import { GET as listEnrollments } from '@/app/api/admin/crew-enrollments/route';
import { POST as resetPassword } from '@/app/api/admin/users/[id]/password/route';
import { POST as submitEnrollment } from '@/app/api/enrollment/crew/route';
import { GET as enrollmentStatus } from '@/app/api/enrollment/crew/[code]/status/route';
import { prisma } from '@/lib/prisma';
import { toSessionClaims } from '@/lib/rmo/session-claims';
import { hashPassword } from '@/lib/utils';
import { AuthService } from '@/services/internal/auth/auth';
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

jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({
    set: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
  })),
}));

const CREW_PASSWORD = 'CrewPass123!';

const schema = {
  sections: ['Enrollment questions'],
  fields: [
    {
      id: 'note',
      key: 'note',
      label: 'Note',
      type: 'TEXT',
      required: true,
      placeholder: '',
      helpText: '',
      options: [],
      validation: {},
      displayOrder: 0,
      section: 'Enrollment questions',
    },
  ],
};

async function userWith(input: {
  name: string;
  email: string;
  loginId: string;
  rmoRole: 'SYSTEM_ADMIN' | 'DIVISION_ADMIN' | 'CREW_USER';
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

function context(id: number | string) {
  return { params: Promise.resolve({ id: String(id), code: String(id) }) };
}

async function jsonOf(response: Response) {
  return response.json();
}

describe('crew enrollment', () => {
  let sequence = 0;
  let org: {
    system: Awaited<ReturnType<typeof userWith>>;
    ahmedabadAdmin: Awaited<ReturnType<typeof userWith>>;
    suratAdmin: Awaited<ReturnType<typeof userWith>>;
    zone: { id: number };
    ahmedabad: { id: number };
    surat: { id: number };
    vatva: { id: number };
    botad: { id: number };
    suratLobby: { id: number };
  };

  beforeEach(async () => {
    await cleanupDatabase();
    sequence += 1;
    const zone = await prisma.zone.create({ data: { name: 'West', code: `W${sequence}` } });
    const ahmedabad = await prisma.division.create({
      data: { name: 'Ahmedabad', code: `AMD${sequence}`, zoneId: zone.id },
    });
    const surat = await prisma.division.create({
      data: { name: 'Surat', code: `ST${sequence}`, zoneId: zone.id },
    });
    const vatva = await prisma.lobby.create({
      data: { name: 'Vatva', code: `VAT${sequence}`, divisionId: ahmedabad.id },
    });
    const botad = await prisma.lobby.create({
      data: { name: 'Botad', code: `BOT${sequence}`, divisionId: ahmedabad.id },
    });
    const suratLobby = await prisma.lobby.create({
      data: { name: 'Udhna', code: `UDH${sequence}`, divisionId: surat.id },
    });
    const system = await userWith({
      name: 'System',
      email: `sys${sequence}@example.com`,
      loginId: `sys${sequence}`,
      rmoRole: 'SYSTEM_ADMIN',
    });
    const form = await prisma.form.create({
      data: {
        name: 'Crew Enrollment',
        purpose: 'CREW_ENROLLMENT',
        status: 'PUBLISHED',
        createdById: system.id,
      },
    });
    const version = await prisma.formVersion.create({
      data: {
        formId: form.id,
        versionNumber: 1,
        status: 'PUBLISHED',
        schema,
        createdById: system.id,
      },
    });
    await prisma.form.update({ where: { id: form.id }, data: { currentVersionId: version.id } });
    org = {
      system,
      ahmedabadAdmin: await userWith({
        name: 'Ahmedabad Admin',
        email: `amd${sequence}@example.com`,
        loginId: `amd${sequence}`,
        rmoRole: 'DIVISION_ADMIN',
        homeZoneId: zone.id,
        homeDivisionId: ahmedabad.id,
      }),
      suratAdmin: await userWith({
        name: 'Surat Admin',
        email: `sur${sequence}@example.com`,
        loginId: `sur${sequence}`,
        rmoRole: 'DIVISION_ADMIN',
        homeZoneId: zone.id,
        homeDivisionId: surat.id,
      }),
      zone,
      ahmedabad,
      surat,
      vatva,
      botad,
      suratLobby,
    };
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  function payload(overrides: Record<string, unknown> = {}) {
    sequence += 1;
    return {
      fullName: 'Amit Patel',
      email: `amit${sequence}@example.com`,
      phone: '9876543210',
      employeeId: `EMP${sequence}`,
      staffNumber: `STF${sequence}`,
      loginId: `amit${sequence}`,
      password: CREW_PASSWORD,
      confirmPassword: CREW_PASSWORD,
      zoneId: org.zone.id,
      divisionId: org.ahmedabad.id,
      lobbyId: org.vatva.id,
      answers: { note: 'Ready' },
      ...overrides,
    };
  }

  async function enroll(body: Record<string, unknown>) {
    const response = await submitEnrollment(requestFor(null, '/api/enrollment/crew', 'POST', body));
    return { response, body: await jsonOf(response) };
  }

  it('accepts a valid enrollment and hides the password', async () => {
    const input = payload();
    const { response, body } = await enroll(input);
    expect(response.status).toBe(201);
    expect(body.data.applicationId).toMatch(/^RMO-ENR-/);
    expect(body.data.status).toBe('PENDING');
    expect(body.data.requestedDivision).toBe('Ahmedabad');
    expect(JSON.stringify(body)).not.toContain(CREW_PASSWORD);
    expect(JSON.stringify(body)).not.toContain('passwordHash');

    const stored = await prisma.crewEnrollment.findFirst({ where: { email: input.email } });
    expect(stored?.passwordHash.startsWith('$2')).toBe(true);
    expect(stored?.passwordHash).not.toBe(CREW_PASSWORD);
    expect(stored?.status).toBe('PENDING');
    expect(await prisma.user.findFirst({ where: { email: input.email } })).toBeNull();

    const status = await enrollmentStatus(
      requestFor(null, `/api/enrollment/crew/${body.data.applicationId}/status`, 'GET'),
      { params: Promise.resolve({ code: body.data.applicationId }) },
    );
    expect((await jsonOf(status)).data.status).toBe('PENDING');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'crew_enrollment.created' } });
    expect(JSON.stringify(audit?.metadata)).not.toContain(CREW_PASSWORD);
    expect(JSON.stringify(audit?.metadata)).not.toContain(stored?.passwordHash);

    const pendingLogin = await AuthService.login({ identifier: input.loginId, password: CREW_PASSWORD });
    expect(pendingLogin.success).toBe(false);
    expect(pendingLogin.message).toBe('Your crew enrollment is awaiting approval.');
  });

  it('rejects invalid enrollment input and duplicates', async () => {
    expect((await enroll(payload({ email: 'not-an-email' }))).response.status).toBe(400);
    expect((await enroll(payload({ password: 'short', confirmPassword: 'short' }))).response.status).toBe(400);
    expect((await enroll(payload({ confirmPassword: 'OtherPass123!' }))).response.status).toBe(400);
    expect((await enroll(payload({ fullName: '  ' }))).response.status).toBe(400);
    expect((await enroll(payload({ divisionId: 999999 }))).response.status).toBe(400);
    expect((await enroll(payload({ lobbyId: 999999 }))).response.status).toBe(400);
    expect((await enroll(payload({ lobbyId: org.suratLobby.id }))).response.status).toBe(400);
    expect((await enroll(payload({ answers: {} }))).response.status).toBe(400);

    const input = payload();
    expect((await enroll(input)).response.status).toBe(201);
    const duplicate = await enroll(input);
    expect(duplicate.response.status).toBe(400);
    expect(duplicate.body.message).toMatch(/awaiting approval/);

    await prisma.user.create({
      data: {
        name: 'Existing',
        email: 'taken@example.com',
        loginId: 'takenuser',
        password: await hashPassword(CREW_PASSWORD),
        rmoRole: 'CREW_USER',
        accountStatus: 'ACTIVE',
      },
    });
    const taken = await enroll(payload({ email: 'taken@example.com', loginId: 'freshlogin' }));
    expect(taken.response.status).toBe(400);
    expect(taken.body.message).toMatch(/already exists/);
  });

  it('lets a division admin approve only their own division into an active crew user', async () => {
    const input = payload();
    const created = await enroll(input);
    const id = (await prisma.crewEnrollment.findFirst({ where: { email: input.email } }))?.id as number;
    const detail = await getEnrollment(
      requestFor(org.ahmedabadAdmin, `/api/admin/crew-enrollments/${id}`, 'GET'),
      context(id),
    );
    const detailBody = await jsonOf(detail);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detailBody)).not.toContain(CREW_PASSWORD);
    expect(JSON.stringify(detailBody)).not.toContain('passwordHash');
    expect(detailBody.data.answers.note).toBe('Ready');

    const suratView = await getEnrollment(
      requestFor(org.suratAdmin, `/api/admin/crew-enrollments/${id}`, 'GET'),
      context(id),
    );
    expect(suratView.status).toBe(403);
    const suratList = await listEnrollments(
      requestFor(org.suratAdmin, '/api/admin/crew-enrollments', 'GET'),
    );
    expect((await jsonOf(suratList)).data.items).toHaveLength(0);
    expect((await approveEnrollment(
      requestFor(org.suratAdmin, `/api/admin/crew-enrollments/${id}/approve`, 'POST', { lobbyId: org.vatva.id }),
      context(id),
    )).status).toBe(403);
    expect((await rejectEnrollment(
      requestFor(org.suratAdmin, `/api/admin/crew-enrollments/${id}/reject`, 'POST', { reason: 'No' }),
      context(id),
    )).status).toBe(403);

    const wrongRole = await approveEnrollment(
      requestFor(org.ahmedabadAdmin, `/api/admin/crew-enrollments/${id}/approve`, 'POST', {
        lobbyId: org.botad.id,
        rmoRole: 'SYSTEM_ADMIN',
      }),
      context(id),
    );
    expect(wrongRole.status).toBe(400);
    const setPassword = await approveEnrollment(
      requestFor(org.ahmedabadAdmin, `/api/admin/crew-enrollments/${id}/approve`, 'POST', {
        lobbyId: org.botad.id,
        password: 'AdminSet123!',
      }),
      context(id),
    );
    expect(setPassword.status).toBe(400);
    const outsideLobby = await approveEnrollment(
      requestFor(org.ahmedabadAdmin, `/api/admin/crew-enrollments/${id}/approve`, 'POST', {
        lobbyId: org.suratLobby.id,
      }),
      context(id),
    );
    expect(outsideLobby.status).toBe(403);

    const approved = await approveEnrollment(
      requestFor(org.ahmedabadAdmin, `/api/admin/crew-enrollments/${id}/approve`, 'POST', {
        lobbyId: org.botad.id,
      }),
      context(id),
    );
    const approvedBody = await jsonOf(approved);
    expect(approved.status).toBe(200);
    expect(approvedBody.data.status).toBe('APPROVED');
    expect(JSON.stringify(approvedBody)).not.toContain(CREW_PASSWORD);

    const user = await prisma.user.findFirst({ where: { email: input.email } });
    expect(user?.rmoRole).toBe('CREW_USER');
    expect(user?.accountStatus).toBe('ACTIVE');
    expect(user?.homeDivisionId).toBe(org.ahmedabad.id);
    expect(user?.homeLobbyId).toBe(org.botad.id);
    expect(user?.password?.startsWith('$2')).toBe(true);
    const enrollment = await prisma.crewEnrollment.findUnique({ where: { id } });
    expect(enrollment?.createdUserId).toBe(user?.id);
    expect(enrollment?.formSubmissionId).not.toBeNull();
    expect(user?.password).toBe(enrollment?.passwordHash);

    const signedIn = await AuthService.login({ identifier: input.loginId, password: CREW_PASSWORD });
    expect(signedIn.success).toBe(true);
    expect(signedIn.data?.user?.rmoRole).toBe('CREW_USER');

    const reset = await resetPassword(
      requestFor(org.ahmedabadAdmin, `/api/admin/users/${user?.id}/password`, 'POST', {
        password: 'NewPassword123!',
      }),
      context(user?.id || 0),
    );
    expect(reset.status).toBe(403);

    const audits = await prisma.auditLog.findMany({
      where: { action: { in: ['crew_enrollment.approved', 'user.created'] } },
    });
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain(CREW_PASSWORD);
    expect(JSON.stringify(audits)).not.toContain(user?.password);
    expect(created.body.data.applicationId).toContain('RMO-ENR-');
  });

  it('rejects an enrollment without creating a crew account', async () => {
    const input = payload();
    await enroll(input);
    const id = (await prisma.crewEnrollment.findFirst({ where: { email: input.email } }))?.id as number;
    const missing = await rejectEnrollment(
      requestFor(org.ahmedabadAdmin, `/api/admin/crew-enrollments/${id}/reject`, 'POST', {}),
      context(id),
    );
    expect(missing.status).toBe(400);
    const rejected = await rejectEnrollment(
      requestFor(org.ahmedabadAdmin, `/api/admin/crew-enrollments/${id}/reject`, 'POST', {
        reason: 'Documents do not match.',
      }),
      context(id),
    );
    expect(rejected.status).toBe(200);
    expect((await jsonOf(rejected)).data.status).toBe('REJECTED');
    expect(await prisma.user.findFirst({ where: { email: input.email } })).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { action: 'crew_enrollment.rejected' } });
    expect(audit?.metadata).toMatchObject({ reason: 'Documents do not match.' });
    const login = await AuthService.login({ identifier: input.loginId, password: CREW_PASSWORD });
    expect(login.success).toBe(false);
    expect(login.message).toBe('Your crew enrollment was not approved.');
  });

  it('lets a system admin see every division without approving', async () => {
    await enroll(payload());
    await enroll(payload({ divisionId: org.surat.id, lobbyId: org.suratLobby.id }));
    const all = await listEnrollments(requestFor(org.system, '/api/admin/crew-enrollments', 'GET'));
    const allBody = await jsonOf(all);
    expect(allBody.data.items).toHaveLength(2);
    expect(JSON.stringify(allBody)).not.toContain('passwordHash');
    const filtered = await listEnrollments(
      requestFor(org.system, `/api/admin/crew-enrollments?divisionId=${org.surat.id}&status=PENDING`, 'GET'),
    );
    const filteredBody = await jsonOf(filtered);
    expect(filteredBody.data.items).toHaveLength(1);
    expect(filteredBody.data.items[0].requestedDivision.name).toBe('Surat');
    const id = allBody.data.items[0].id;
    const approve = await approveEnrollment(
      requestFor(org.system, `/api/admin/crew-enrollments/${id}/approve`, 'POST', { lobbyId: org.vatva.id }),
      context(id),
    );
    expect(approve.status).toBe(403);
  });
});
