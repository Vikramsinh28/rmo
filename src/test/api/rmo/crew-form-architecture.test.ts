import { GET as listCrewTypes, POST as createCrewType } from '@/app/api/admin/crew-types/route';
import { PATCH as updateCrewType } from '@/app/api/admin/crew-types/[id]/route';
import { GET as listDutyTypes, POST as createDutyType } from '@/app/api/admin/duty-types/route';
import { GET as listRegisterTypes, POST as createRegisterType } from '@/app/api/admin/register-types/route';
import { GET as listQuestions, POST as createQuestion } from '@/app/api/admin/questions/route';
import { PATCH as updateQuestion } from '@/app/api/admin/questions/[id]/route';
import {
  GET as listConfigs,
  PUT as replaceConfigs,
} from '@/app/api/admin/question-configurations/route';
import { GET as previewCrewForm } from '@/app/api/admin/crew-form/preview/route';
import { GET as listUsers, POST as createUser } from '@/app/api/admin/users/route';
import { PATCH as updateUser } from '@/app/api/admin/users/[id]/route';
import { GET as exportSubmissions } from '@/app/api/submissions/export/route';
import { GET as getSubmission } from '@/app/api/submissions/[id]/route';
import { GET as listSubmissions, POST as createSubmission } from '@/app/api/submissions/route';
import { GET as analyticsRegisterTypes } from '@/app/api/analytics/register-types/route';
import { POST as legacyImport } from '@/app/api/admin/legacy-import/route';
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

async function jsonOf(response: Response) {
  return response.json() as Promise<{ success: boolean; message?: string; data?: any }>;
}

describe('Dynamic crew form + register mapping', () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterAll(async () => {
    await cleanupDatabase();
    await testPrisma.$disconnect();
    await prisma.$disconnect();
  });

  async function world() {
    const password = await hashPassword(PASSWORD);
    const system = await testPrisma.user.create({
      data: {
        email: 'sys@example.com',
        name: 'System',
        loginId: 'sys',
        password,
        role: 'ADMIN',
        rmoRole: 'SYSTEM_ADMIN',
        accountStatus: 'ACTIVE',
        isOnboarded: true,
      },
    });
    const zone = await testPrisma.zone.create({ data: { name: 'West', code: 'W' } });
    const division = await testPrisma.division.create({
      data: { name: 'Ahmedabad', code: 'ADI', zoneId: zone.id },
    });
    const otherDivision = await testPrisma.division.create({
      data: { name: 'Surat', code: 'ST', zoneId: zone.id },
    });
    const lobby = await testPrisma.lobby.create({
      data: { name: 'Vatva', code: 'VATVA', divisionId: division.id },
    });
    const divisionAdmin = await testPrisma.user.create({
      data: {
        email: 'div@example.com',
        name: 'Division Admin',
        loginId: 'divadmin',
        password,
        role: 'USER',
        rmoRole: 'DIVISION_ADMIN',
        accountStatus: 'ACTIVE',
        isOnboarded: true,
        homeZoneId: zone.id,
        homeDivisionId: division.id,
      },
    });
    return { system, zone, division, otherDivision, lobby, divisionAdmin, password };
  }

  it('supports masters, user crew type, one form, register metadata, snapshots, and export', async () => {
    const org = await world();

    const alpCreate = await createCrewType(
      await requestFor(org.system, '/api/admin/crew-types', 'POST', {
        code: 'ALP',
        name: 'ALP',
        description: 'Assistant Loco Pilot',
      }),
    );
    expect(alpCreate.status).toBe(201);
    const alp = (await jsonOf(alpCreate)).data;

    const lpCreate = await createCrewType(
      await requestFor(org.system, '/api/admin/crew-types', 'POST', {
        code: 'LP',
        name: 'LP',
      }),
    );
    expect(lpCreate.status).toBe(201);
    const lp = (await jsonOf(lpCreate)).data;

    const disable = await updateCrewType(
      await requestFor(org.system, `/api/admin/crew-types/${lp.id}`, 'PATCH', {
        status: 'INACTIVE',
      }),
      context(lp.id),
    );
    expect(disable.status).toBe(200);
    expect((await jsonOf(disable)).data.status).toBe('INACTIVE');

    const signOn = (
      await jsonOf(
        await createDutyType(
          await requestFor(org.system, '/api/admin/duty-types', 'POST', {
            code: 'SIGN_ON',
            name: 'Sign On',
          }),
        ),
      )
    ).data;
    const signOff = (
      await jsonOf(
        await createDutyType(
          await requestFor(org.system, '/api/admin/duty-types', 'POST', {
            code: 'SIGN_OFF',
            name: 'Sign Off',
          }),
        ),
      )
    ).data;
    const detonator = (
      await jsonOf(
        await createRegisterType(
          await requestFor(org.system, '/api/admin/register-types', 'POST', {
            code: 'DETONATOR',
            name: 'Detonator',
          }),
        ),
      )
    ).data;
    const safety = (
      await jsonOf(
        await createRegisterType(
          await requestFor(org.system, '/api/admin/register-types', 'POST', {
            code: 'SAFETY',
            name: 'Safety',
          }),
        ),
      )
    ).data;

    const q1 = (
      await jsonOf(
        await createQuestion(
          await requestFor(org.system, '/api/admin/questions', 'POST', {
            code: 'DET_CHECKED',
            text: 'Was the detonator checked?',
            type: 'YES_NO',
            required: true,
          }),
        ),
      )
    ).data;
    const q2 = (
      await jsonOf(
        await createQuestion(
          await requestFor(org.system, '/api/admin/questions', 'POST', {
            code: 'SAFE_CHECKED',
            text: 'Was safety equipment checked?',
            type: 'YES_NO',
            required: true,
          }),
        ),
      )
    ).data;
    const q3 = (
      await jsonOf(
        await createQuestion(
          await requestFor(org.system, '/api/admin/questions', 'POST', {
            code: 'EQ_NUMBER',
            text: 'Enter equipment number',
            type: 'TEXT',
            required: false,
          }),
        ),
      )
    ).data;

    await updateQuestion(
      await requestFor(org.system, `/api/admin/questions/${q1.id}`, 'PATCH', {
        registerTypeIds: [detonator.id, safety.id],
      }),
      context(q1.id),
    );
    await updateQuestion(
      await requestFor(org.system, `/api/admin/questions/${q2.id}`, 'PATCH', {
        registerTypeIds: [safety.id],
      }),
      context(q2.id),
    );

    const configOn = await replaceConfigs(
      await requestFor(org.system, '/api/admin/question-configurations', 'PUT', {
        crewTypeId: alp.id,
        dutyTypeId: signOn.id,
        items: [
          { questionId: q1.id, displayOrder: 0, required: true },
          { questionId: q2.id, displayOrder: 1, required: true },
          { questionId: q3.id, displayOrder: 2, required: false },
        ],
      }),
    );
    expect(configOn.status).toBe(200);
    expect((await jsonOf(configOn)).data.items).toHaveLength(3);

    await replaceConfigs(
      await requestFor(org.system, '/api/admin/question-configurations', 'PUT', {
        crewTypeId: alp.id,
        dutyTypeId: signOff.id,
        items: [{ questionId: q2.id, displayOrder: 0, required: true }],
      }),
    );

    const previewOn = await previewCrewForm(
      await requestFor(
        org.system,
        `/api/admin/crew-form/preview?crewTypeId=${alp.id}&dutyTypeId=${signOn.id}`,
        'GET',
      ),
    );
    expect(previewOn.status).toBe(200);
    expect((await jsonOf(previewOn)).data.schema.fields).toHaveLength(3);

    const previewOff = await previewCrewForm(
      await requestFor(
        org.system,
        `/api/admin/crew-form/preview?crewTypeId=${alp.id}&dutyTypeId=${signOff.id}`,
        'GET',
      ),
    );
    expect((await jsonOf(previewOff)).data.schema.fields).toHaveLength(1);

    const createdCrew = await createUser(
      await requestFor(org.system, '/api/admin/users', 'POST', {
        name: 'Rahul Patel',
        email: 'rahul@example.com',
        loginId: 'rahul',
        password: PASSWORD,
        rmoRole: 'CREW_USER',
        homeZoneId: org.zone.id,
        homeDivisionId: org.division.id,
        homeLobbyId: org.lobby.id,
        crewTypeId: alp.id,
      }),
    );
    expect(createdCrew.status).toBe(201);
    const crewUser = (await jsonOf(createdCrew)).data;
    expect(crewUser.crewType.code).toBe('ALP');

    const crewCannotChange = await updateUser(
      await requestFor(crewUser, `/api/admin/users/${crewUser.id}`, 'PATCH', {
        crewTypeId: lp.id,
      }),
      context(crewUser.id),
    );
    expect(crewCannotChange.status).toBe(403);

    const bypassCrewType = await createSubmission(
      await requestFor(crewUser, '/api/submissions', 'POST', {
        dutyTypeId: signOn.id,
        crewTypeId: lp.id,
        answers: { DET_CHECKED: true, SAFE_CHECKED: true, EQ_NUMBER: 'E-1' },
      }),
    );
    expect(bypassCrewType.status).toBe(403);

    const bypassDivision = await createSubmission(
      await requestFor(crewUser, '/api/submissions', 'POST', {
        dutyTypeId: signOn.id,
        divisionId: org.otherDivision.id,
        answers: { DET_CHECKED: true, SAFE_CHECKED: true },
      }),
    );
    expect(bypassDivision.status).toBe(403);

    const withRegister = await createSubmission(
      await requestFor(crewUser, '/api/submissions', 'POST', {
        dutyTypeId: signOn.id,
        registerId: 1,
        answers: { DET_CHECKED: true, SAFE_CHECKED: true },
      }),
    );
    expect(withRegister.status).toBe(400);

    const submitted = await createSubmission(
      await requestFor(crewUser, '/api/submissions', 'POST', {
        dutyTypeId: signOn.id,
        answers: { DET_CHECKED: true, SAFE_CHECKED: true, EQ_NUMBER: 'EQ-9' },
      }),
    );
    expect(submitted.status).toBe(201);
    const submission = (await jsonOf(submitted)).data;
    expect(submission.crewTypeName).toBe('ALP');
    expect(submission.dutyTypeName).toBe('Sign On');
    expect(submission.answerRows).toHaveLength(3);

    const detailAll = await getSubmission(
      await requestFor(org.divisionAdmin, `/api/submissions/${submission.id}`, 'GET'),
      context(submission.id),
    );
    expect((await jsonOf(detailAll)).data.answerRows).toHaveLength(3);

    const detailDet = await getSubmission(
      await requestFor(
        org.divisionAdmin,
        `/api/submissions/${submission.id}?registerTypeId=${detonator.id}`,
        'GET',
      ),
      context(submission.id),
    );
    const detailDetBody = await jsonOf(detailDet);
    expect(detailDetBody.data.answerRows).toHaveLength(1);
    expect(detailDetBody.data.answerRows[0].question.code).toBe('DET_CHECKED');

    await testPrisma.crewType.update({
      where: { id: lp.id },
      data: { status: 'ACTIVE' },
    });
    await updateUser(
      await requestFor(org.system, `/api/admin/users/${crewUser.id}`, 'PATCH', {
        crewTypeId: lp.id,
      }),
      context(crewUser.id),
    );
    const historical = await getSubmission(
      await requestFor(org.divisionAdmin, `/api/submissions/${submission.id}`, 'GET'),
      context(submission.id),
    );
    expect((await jsonOf(historical)).data.crewTypeName).toBe('ALP');

    const filtered = await listSubmissions(
      await requestFor(
        org.divisionAdmin,
        `/api/submissions?registerTypeId=${detonator.id}`,
        'GET',
      ),
    );
    const filteredBody = await jsonOf(filtered);
    expect(filteredBody.data.items).toHaveLength(1);
    expect(filteredBody.data.items[0].id).toBe(submission.id);

    const analytics = await analyticsRegisterTypes(
      await requestFor(org.divisionAdmin, '/api/analytics/register-types', 'GET'),
    );
    const analyticsBody = await jsonOf(analytics);
    expect(analytics.status).toBe(200);
    expect(analyticsBody.data.items.some((row: any) => row.code === 'DETONATOR')).toBe(true);

    const csvExport = await exportSubmissions(
      await requestFor(
        org.divisionAdmin,
        `/api/submissions/export?registerTypeId=${detonator.id}&format=csv`,
        'GET',
      ),
    );
    expect(csvExport.status).toBe(200);
    const csv = await csvExport.text();
    expect(csv).toContain('Was the detonator checked?');
    expect(csv).toContain('DETONATOR');
    expect(csv).not.toContain('Was safety equipment checked?');
    expect(csv).not.toContain('SAFE_CHECKED');

    const xlsxExport = await exportSubmissions(
      await requestFor(
        org.divisionAdmin,
        `/api/submissions/export?registerTypeId=${detonator.id}&format=xlsx`,
        'GET',
      ),
    );
    expect(xlsxExport.status).toBe(200);
    expect(xlsxExport.headers.get('content-type')).toContain('spreadsheetml');

    const list = await listCrewTypes(
      await requestFor(org.system, '/api/admin/crew-types?status=ACTIVE', 'GET'),
    );
    expect((await jsonOf(list)).data.items.some((row: any) => row.code === 'ALP')).toBe(true);
    expect((await jsonOf(await listDutyTypes(await requestFor(org.system, '/api/admin/duty-types', 'GET')))).data.items.length).toBeGreaterThan(0);
    expect((await jsonOf(await listRegisterTypes(await requestFor(org.system, '/api/admin/register-types', 'GET')))).data.items.length).toBeGreaterThan(0);
    expect((await jsonOf(await listQuestions(await requestFor(org.system, '/api/admin/questions', 'GET')))).data.items.length).toBe(3);
    expect(
      (
        await jsonOf(
          await listConfigs(
            await requestFor(
              org.system,
              `/api/admin/question-configurations?crewTypeId=${alp.id}&dutyTypeId=${signOn.id}`,
              'GET',
            ),
          ),
        )
      ).data.items.length,
    ).toBe(3);

    const users = await listUsers(await requestFor(org.system, '/api/admin/users?role=CREW_USER', 'GET'));
    expect((await jsonOf(users)).data.items[0].crewType.code).toBe('LP');

    const imported = await legacyImport(
      await requestFor(org.system, '/api/admin/legacy-import', 'POST', {
        registerTypes: [{ code: 'EQUIPMENT', name: 'Equipment' }],
        questions: [
          {
            code: 'EQ_HANDOVER',
            text: 'Was the equipment handed over?',
            type: 'YES_NO',
            registers: ['EQUIPMENT', 'MISSING_REG'],
          },
        ],
      }),
    );
    const importBody = await jsonOf(imported);
    expect(imported.status).toBe(200);
    expect(importBody.data.summary.Imported).toBeGreaterThan(0);
    expect(importBody.data.summary['Needs Review']).toBeGreaterThan(0);
  });
});
