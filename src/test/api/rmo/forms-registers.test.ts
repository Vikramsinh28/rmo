import { POST as archiveForm } from '@/app/api/admin/forms/[id]/archive/route';
import { GET as getForm, PATCH as updateForm } from '@/app/api/admin/forms/[id]/route';
import { POST as publishForm } from '@/app/api/admin/forms/[id]/publish/route';
import { GET as listForms, POST as createForm } from '@/app/api/admin/forms/route';
import { GET as getRegister, PATCH as updateRegister } from '@/app/api/admin/registers/[id]/route';
import { GET as listRegisterEntries } from '@/app/api/admin/registers/[id]/entries/route';
import { GET as exportRegisterXlsx } from '@/app/api/admin/registers/[id]/export/route';
import { GET as previewRegisterExport } from '@/app/api/admin/registers/[id]/export/preview/route';
import {
  GET as listRegisterFields,
  PUT as replaceRegisterFields,
} from '@/app/api/admin/registers/[id]/fields/route';
import { GET as listRegisters, POST as createRegister } from '@/app/api/admin/registers/route';
import { GET as analyticsForms } from '@/app/api/analytics/forms/route';
import { GET as analyticsLobbies } from '@/app/api/analytics/lobbies/route';
import { GET as analyticsSubmissions } from '@/app/api/analytics/submissions/route';
import { GET as exportSubmissions } from '@/app/api/submissions/export/route';
import { GET as previewSubmissionsExport } from '@/app/api/submissions/export/preview/route';
import { GET as exportSubmissionsXlsx } from '@/app/api/submissions/export/xlsx/route';
import { GET as getSubmission, PATCH as updateSubmission } from '@/app/api/submissions/[id]/route';
import { GET as listSubmissions, POST as createSubmission } from '@/app/api/submissions/route';
import { seedClientRegistersForDivision } from '@/services/internal/rmo/client-registers';
import { POST as createDivision } from '@/app/api/admin/divisions/route';
import { POST as createLobby } from '@/app/api/admin/lobbies/route';
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

const schema = {
  sections: ['General'],
  fields: [
    {
      id: 'crew_name',
      key: 'crew_name',
      label: 'Crew name',
      type: 'TEXT',
      required: true,
      placeholder: '',
      helpText: '',
      options: [],
      validation: {},
      displayOrder: 0,
      section: 'General',
    },
  ],
};

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

describe('Forms, registers, and submissions', () => {
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
    const admin = await testPrisma.user.create({
      data: {
        email: 'root@example.com',
        name: 'Root',
        loginId: 'root',
        password,
        role: 'ADMIN',
        rmoRole: 'SYSTEM_ADMIN',
        isOnboarded: true,
      },
    });
    const zone = (await jsonOf(await createZone(await requestFor(admin, '/api/admin/zones', 'POST', {
      name: 'West',
      code: 'WEST',
    })))).data;
    const ahmedabad = (await jsonOf(await createDivision(await requestFor(admin, '/api/admin/divisions', 'POST', {
      zoneId: zone.id,
      name: 'Ahmedabad',
      code: 'ADI',
    })))).data;
    const surat = (await jsonOf(await createDivision(await requestFor(admin, '/api/admin/divisions', 'POST', {
      zoneId: zone.id,
      name: 'Surat',
      code: 'ST',
    })))).data;
    const lobbyA1 = (await jsonOf(await createLobby(await requestFor(admin, '/api/admin/lobbies', 'POST', {
      divisionId: ahmedabad.id,
      name: 'Lobby A1',
      code: 'A1',
    })))).data;
    const lobbyA2 = (await jsonOf(await createLobby(await requestFor(admin, '/api/admin/lobbies', 'POST', {
      divisionId: ahmedabad.id,
      name: 'Lobby A2',
      code: 'A2',
    })))).data;
    const lobbyB1 = (await jsonOf(await createLobby(await requestFor(admin, '/api/admin/lobbies', 'POST', {
      divisionId: surat.id,
      name: 'Lobby B1',
      code: 'B1',
    })))).data;
    const divisionAdmin = await testPrisma.user.create({
      data: {
        email: 'adi-admin@example.com',
        name: 'Ahmedabad Admin',
        loginId: 'adi-admin',
        password,
        role: 'USER',
        rmoRole: 'DIVISION_ADMIN',
        isOnboarded: true,
        homeZoneId: zone.id,
        homeDivisionId: ahmedabad.id,
      },
    });
    const suratAdmin = await testPrisma.user.create({
      data: {
        email: 'st-admin@example.com',
        name: 'Surat Admin',
        loginId: 'st-admin',
        password,
        role: 'USER',
        rmoRole: 'DIVISION_ADMIN',
        isOnboarded: true,
        homeZoneId: zone.id,
        homeDivisionId: surat.id,
      },
    });
    const lobbyUser = await testPrisma.user.create({
      data: {
        email: 'lobby-a1@example.com',
        name: 'Lobby A1 User',
        loginId: 'lobby-a1',
        password,
        role: 'USER',
        rmoRole: 'LOBBY_USER',
        isOnboarded: true,
        homeZoneId: zone.id,
        homeDivisionId: ahmedabad.id,
        homeLobbyId: lobbyA1.id,
      },
    });
    const crewA = await testPrisma.user.create({
      data: {
        email: 'crew-a@example.com',
        name: 'Crew A',
        loginId: 'crew-a',
        password,
        role: 'USER',
        rmoRole: 'CREW_USER',
        isOnboarded: true,
        homeZoneId: zone.id,
        homeDivisionId: ahmedabad.id,
        homeLobbyId: lobbyA1.id,
      },
    });
    const crewB = await testPrisma.user.create({
      data: {
        email: 'crew-b@example.com',
        name: 'Crew B',
        loginId: 'crew-b',
        password,
        role: 'USER',
        rmoRole: 'CREW_USER',
        isOnboarded: true,
        homeZoneId: zone.id,
        homeDivisionId: ahmedabad.id,
        homeLobbyId: lobbyA1.id,
      },
    });
    return {
      admin,
      zone,
      ahmedabad,
      surat,
      lobbyA1,
      lobbyA2,
      lobbyB1,
      divisionAdmin,
      suratAdmin,
      lobbyUser,
      crewA,
      crewB,
    };
  }

  async function publishNamed(
    actor: Awaited<ReturnType<typeof world>>['divisionAdmin'],
    name: string,
    divisionId: number,
    lobbyId: number,
  ) {
    const created = await jsonOf(await createForm(await requestFor(actor, '/api/admin/forms', 'POST', {
      name,
      description: `${name} description`,
      schema,
      assignments: [{ divisionId, lobbyId }],
    })));
    expect(created.success).toBe(true);
    const published = await jsonOf(await publishForm(
      await requestFor(actor, `/api/admin/forms/${created.data.id}/publish`, 'POST'),
      context(created.data.id),
    ));
    expect(published.success).toBe(true);
    return published.data;
  }

  it('isolates Ahmedabad records from Surat and keeps submission history on the original version', async () => {
    const org = await world();
    const formA1 = await publishNamed(org.divisionAdmin, 'Form A1', org.ahmedabad.id, org.lobbyA1.id);
    const formA2 = await publishNamed(org.divisionAdmin, 'Form A2', org.ahmedabad.id, org.lobbyA2.id);
    const formB1 = await publishNamed(org.suratAdmin, 'Form B1', org.surat.id, org.lobbyB1.id);

    const ahmedabadForms = await jsonOf(await listForms(await requestFor(org.divisionAdmin, '/api/admin/forms', 'GET')));
    expect(ahmedabadForms.data.items.map((item: { name: string }) => item.name).sort()).toEqual(['Form A1', 'Form A2']);
    const suratFormRead = await getForm(
      await requestFor(org.divisionAdmin, `/api/admin/forms/${formB1.id}`, 'GET'),
      context(formB1.id),
    );
    expect(suratFormRead.status).toBe(403);
    const forcedDivision = await listForms(await requestFor(
      org.divisionAdmin,
      `/api/admin/forms?divisionId=${org.surat.id}`,
      'GET',
    ));
    expect(forcedDivision.status).toBe(403);
    const textDivision = await listSubmissions(await requestFor(
      org.divisionAdmin,
      '/api/submissions?divisionId=surat',
      'GET',
    ));
    expect(textDivision.status).toBe(400);

    const outsideCreate = await createForm(await requestFor(org.divisionAdmin, '/api/admin/forms', 'POST', {
      name: 'Escalation',
      divisionId: org.surat.id,
      schema,
    }));
    expect(outsideCreate.status).toBe(403);

    const allForms = await jsonOf(await listForms(await requestFor(org.admin, '/api/admin/forms', 'GET')));
    expect(allForms.data.items).toHaveLength(3);
    const filtered = await jsonOf(await listForms(await requestFor(
      org.admin,
      `/api/admin/forms?divisionId=${org.surat.id}`,
      'GET',
    )));
    expect(filtered.data.items.map((item: { name: string }) => item.name)).toEqual(['Form B1']);

    const registerA = await jsonOf(await createRegister(await requestFor(org.divisionAdmin, '/api/admin/registers', 'POST', {
      name: 'Register A',
      formId: formA1.id,
    })));
    const registerB = await jsonOf(await createRegister(await requestFor(org.suratAdmin, '/api/admin/registers', 'POST', {
      name: 'Register B',
      formId: formB1.id,
    })));
    const ahmedabadRegisters = await jsonOf(await listRegisters(await requestFor(org.divisionAdmin, '/api/admin/registers', 'GET')));
    expect(ahmedabadRegisters.data.items.map((item: { name: string }) => item.name)).toEqual(['Register A']);
    expect((await getRegister(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${registerB.data.id}`, 'GET'),
      context(registerB.data.id),
    )).status).toBe(403);
    expect((await createRegister(await requestFor(org.divisionAdmin, '/api/admin/registers', 'POST', {
      name: 'Bad register',
      divisionId: org.surat.id,
      formId: formB1.id,
    }))).status).toBe(403);

    const lobbyForms = await jsonOf(await listForms(await requestFor(org.lobbyUser, '/api/admin/forms', 'GET')));
    expect(lobbyForms.data.items.map((item: { name: string }) => item.name)).toEqual(['Form A1']);
    const submitted = await jsonOf(await createSubmission(await requestFor(org.lobbyUser, '/api/submissions', 'POST', {
      formId: formA1.id,
      answers: { crew_name: 'Lobby person' },
    })));
    expect(submitted.data.divisionId).toBe(org.ahmedabad.id);
    expect(submitted.data.lobbyId).toBe(org.lobbyA1.id);
    expect((await createSubmission(await requestFor(org.lobbyUser, '/api/submissions', 'POST', {
      formId: formA2.id,
      answers: { crew_name: 'Nope' },
    }))).status).toBe(403);
    expect((await createSubmission(await requestFor(org.lobbyUser, '/api/submissions', 'POST', {
      formId: formB1.id,
      answers: { crew_name: 'Nope' },
      divisionId: org.surat.id,
    }))).status).toBe(403);

    const crewSubmission = await jsonOf(await createSubmission(await requestFor(org.crewA, '/api/submissions', 'POST', {
      formId: formA1.id,
      answers: { crew_name: 'Crew A' },
    })));
    const otherCrew = await jsonOf(await createSubmission(await requestFor(org.crewB, '/api/submissions', 'POST', {
      formId: formA1.id,
      answers: { crew_name: 'Crew B' },
    })));
    await createSubmission(await requestFor(org.suratAdmin, '/api/submissions', 'POST', {
      formId: formB1.id,
      answers: { crew_name: 'Should fail' },
    }));
    const suratCrew = await testPrisma.user.create({
      data: {
        email: 'crew-surat@example.com',
        name: 'Crew Surat',
        loginId: 'crew-surat',
        password: await hashPassword(PASSWORD),
        role: 'USER',
        rmoRole: 'CREW_USER',
        isOnboarded: true,
        homeZoneId: org.zone.id,
        homeDivisionId: org.surat.id,
        homeLobbyId: org.lobbyB1.id,
      },
    });
    const suratSubmission = await jsonOf(await createSubmission(await requestFor(suratCrew, '/api/submissions', 'POST', {
      formId: formB1.id,
      answers: { crew_name: 'Surat crew' },
    })));

    const ownList = await jsonOf(await listSubmissions(await requestFor(org.crewA, '/api/submissions', 'GET')));
    expect(ownList.data.items).toHaveLength(1);
    expect(ownList.data.items[0].id).toBe(crewSubmission.data.id);
    expect((await getSubmission(
      await requestFor(org.crewA, `/api/submissions/${otherCrew.data.id}`, 'GET'),
      context(otherCrew.data.id),
    )).status).toBe(403);
    expect((await createSubmission(await requestFor(org.crewA, '/api/submissions', 'POST', {
      formId: formA1.id,
      answers: {},
    }))).status).toBe(400);

    const divisionList = await jsonOf(await listSubmissions(await requestFor(org.divisionAdmin, '/api/submissions', 'GET')));
    const divisionNames = divisionList.data.items.map((item: { submittedBy: { loginId: string } }) => item.submittedBy.loginId);
    expect(divisionNames).not.toContain('crew-surat');
    expect((await getSubmission(
      await requestFor(org.divisionAdmin, `/api/submissions/${suratSubmission.data.id}`, 'GET'),
      context(suratSubmission.data.id),
    )).status).toBe(403);
    const exportDenied = await exportSubmissions(await requestFor(
      org.divisionAdmin,
      `/api/submissions/export?divisionId=${org.surat.id}`,
      'GET',
    ));
    expect(exportDenied.status).toBe(403);
    const exportAllowed = await exportSubmissions(await requestFor(org.divisionAdmin, '/api/submissions/export', 'GET'));
    const csv = await exportAllowed.text();
    expect(csv).toContain('crew-a');
    expect(csv).not.toContain('crew-surat');
    expect(csv).not.toContain('Surat crew');

    const adminAll = await jsonOf(await listSubmissions(await requestFor(org.admin, '/api/submissions', 'GET')));
    expect(adminAll.data.total).toBe(4);
    const adminSurat = await jsonOf(await listSubmissions(await requestFor(
      org.admin,
      `/api/submissions?divisionId=${org.surat.id}`,
      'GET',
    )));
    expect(adminSurat.data.items).toHaveLength(1);

    const from = new Date();
    from.setUTCDate(from.getUTCDate() - 6);
    const range = `dateFrom=${from.toISOString().slice(0, 10)}&dateTo=${new Date().toISOString().slice(0, 10)}`;
    const divisionAnalytics = await jsonOf(await analyticsSubmissions(await requestFor(
      org.divisionAdmin,
      `/api/analytics/submissions?${range}`,
      'GET',
    )));
    expect(divisionAnalytics.data.metrics.total).toBe(3);
    expect(divisionAnalytics.data.trend.points.length).toBeGreaterThan(1);
    const crossed = await analyticsSubmissions(await requestFor(
      org.divisionAdmin,
      `/api/analytics/submissions?divisionId=${org.surat.id}`,
      'GET',
    ));
    expect(crossed.status).toBe(403);
    const systemAnalytics = await jsonOf(await analyticsSubmissions(await requestFor(org.admin, `/api/analytics/submissions?${range}`, 'GET')));
    expect(systemAnalytics.data.metrics.total).toBe(4);
    const systemFiltered = await jsonOf(await analyticsSubmissions(await requestFor(
      org.admin,
      `/api/analytics/submissions?${range}&divisionId=${org.ahmedabad.id}`,
      'GET',
    )));
    expect(systemFiltered.data.metrics.total).toBe(3);
    const byForm = await jsonOf(await analyticsForms(await requestFor(
      org.admin,
      `/api/analytics/forms?${range}&divisionId=${org.surat.id}`,
      'GET',
    )));
    expect(byForm.data.items.map((item: { name: string }) => item.name)).toEqual(['Form B1']);
    const byLobby = await jsonOf(await analyticsLobbies(await requestFor(
      org.divisionAdmin,
      `/api/analytics/lobbies?${range}`,
      'GET',
    )));
    expect(byLobby.data.items.every((item: { name: string }) => item.name.startsWith('Lobby A'))).toBe(true);

    const original = await testPrisma.formVersion.findFirst({
      where: { formId: formA1.id, versionNumber: 1 },
    });
    const edited = await jsonOf(await updateForm(
      await requestFor(org.divisionAdmin, `/api/admin/forms/${formA1.id}`, 'PATCH', {
        schema: {
          sections: ['General'],
          fields: [
            schema.fields[0],
            {
              ...schema.fields[0],
              id: 'remarks',
              key: 'remarks',
              label: 'Remarks',
              required: false,
              displayOrder: 1,
            },
          ],
        },
      }),
      context(formA1.id),
    ));
    expect(edited.data.versionCreated).toBe(true);
    const stillOriginal = await testPrisma.formVersion.findFirst({
      where: { id: original?.id },
    });
    expect(JSON.stringify(stillOriginal?.schema)).not.toContain('remarks');
    const historical = await jsonOf(await getSubmission(
      await requestFor(org.crewA, `/api/submissions/${crewSubmission.data.id}`, 'GET'),
      context(crewSubmission.data.id),
    ));
    expect(historical.data.formVersion.schema.fields.map((item: { key: string }) => item.key)).toEqual(['crew_name']);

    await updateSubmission(
      await requestFor(org.divisionAdmin, `/api/submissions/${crewSubmission.data.id}`, 'PATCH', {
        status: 'PENDING',
      }),
      context(crewSubmission.data.id),
    );
    await updateRegister(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${registerA.data.id}`, 'PATCH', {
        status: 'INACTIVE',
      }),
      context(registerA.data.id),
    );
    await archiveForm(
      await requestFor(org.divisionAdmin, `/api/admin/forms/${formA2.id}/archive`, 'POST'),
      context(formA2.id),
    );
    const actions = (await testPrisma.auditLog.findMany({ select: { action: true, metadata: true } }))
      .map(row => row.action);
    expect(actions).toEqual(expect.arrayContaining([
      'form.created',
      'form.published',
      'form.version_created',
      'form.archived',
      'register.created',
      'register.disabled',
      'submission.created',
      'submission.updated',
      'submission.exported',
    ]));
    const leaked = JSON.stringify(await testPrisma.auditLog.findMany());
    expect(leaked).not.toContain(PASSWORD);
    expect(leaked).not.toContain('test-token');
  });

  test('register field mapping, entries visibility, and xlsx export stay division-scoped', async () => {
    const org = await world();
    const form = (await jsonOf(await createForm(await requestFor(org.divisionAdmin, '/api/admin/forms', 'POST', {
      name: 'Duty Form',
      schema: {
        sections: ['General'],
        fields: [
          {
            id: 'train_no',
            key: 'train_no',
            label: 'Train no',
            type: 'TEXT',
            required: false,
            placeholder: '',
            helpText: '',
            options: [],
            validation: {},
            displayOrder: 0,
            section: 'General',
          },
          {
            id: 'detonator_no',
            key: 'detonator_no',
            label: 'Detonator no',
            type: 'TEXT',
            required: false,
            placeholder: '',
            helpText: '',
            options: [],
            validation: {},
            displayOrder: 1,
            section: 'General',
          },
        ],
      },
    })))).data;
    await publishForm(
      await requestFor(org.divisionAdmin, `/api/admin/forms/${form.id}/publish`, 'POST'),
      context(form.id),
    );
    await testPrisma.formAssignment.create({
      data: { formId: form.id, divisionId: org.ahmedabad.id, lobbyId: org.lobbyA1.id },
    });

    const register = (await jsonOf(await createRegister(await requestFor(org.divisionAdmin, '/api/admin/registers', 'POST', {
      name: 'Detonator Book',
      formId: form.id,
    })))).data;

    expect((await replaceRegisterFields(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/fields`, 'PUT', {
        fields: [{ fieldKey: 'missing_key', isKeyField: true }],
      }),
      context(register.id),
    )).status).toBe(400);

    const mapped = await jsonOf(await replaceRegisterFields(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/fields`, 'PUT', {
        fields: [
          { fieldKey: 'train_no', sortOrder: 0, isKeyField: false },
          { fieldKey: 'detonator_no', sortOrder: 1, isKeyField: true, columnLabel: 'Detonator' },
        ],
      }),
      context(register.id),
    ));
    expect(mapped.data.fields).toHaveLength(2);
    expect(mapped.data.fields[1].columnLabel).toBe('Detonator');

    const fields = await jsonOf(await listRegisterFields(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/fields`, 'GET'),
      context(register.id),
    ));
    expect(fields.data.availableFields.map((item: { key: string }) => item.key)).toEqual(
      expect.arrayContaining(['train_no', 'detonator_no']),
    );

    await createSubmission(await requestFor(org.crewA, '/api/submissions', 'POST', {
      formId: form.id,
      answers: { train_no: '12934' },
    }));
    const withKey = await jsonOf(await createSubmission(await requestFor(org.crewB, '/api/submissions', 'POST', {
      formId: form.id,
      answers: { train_no: '19019', detonator_no: 'D-9' },
    })));

    const entries = await jsonOf(await listRegisterEntries(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/entries`, 'GET'),
      context(register.id),
    ));
    expect(entries.data.total).toBe(1);
    expect(entries.data.entries[0].submissionId).toBe(withKey.data.id);
    expect(entries.data.entries[0].values.detonator_no).toBe('D-9');

    const suratRegister = (await jsonOf(await createRegister(await requestFor(org.suratAdmin, '/api/admin/registers', 'POST', {
      name: 'Surat Book',
      formId: (await jsonOf(await createForm(await requestFor(org.suratAdmin, '/api/admin/forms', 'POST', {
        name: 'Surat Duty',
        schema: {
          sections: ['General'],
          fields: [
            {
              id: 'detonator_no',
              key: 'detonator_no',
              label: 'Detonator no',
              type: 'TEXT',
              required: false,
              placeholder: '',
              helpText: '',
              options: [],
              validation: {},
              displayOrder: 0,
              section: 'General',
            },
          ],
        },
      })))).data.id,
    })))).data;
    const suratFormId = suratRegister.formId;
    await publishForm(
      await requestFor(org.suratAdmin, `/api/admin/forms/${suratFormId}/publish`, 'POST'),
      context(suratFormId),
    );
    expect((await listRegisterEntries(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${suratRegister.id}/entries`, 'GET'),
      context(suratRegister.id),
    )).status).toBe(403);

    const preview = await jsonOf(await previewRegisterExport(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/export/preview`, 'GET'),
      context(register.id),
    ));
    expect(preview.data.workbook.sheets[0].row_count).toBe(1);
    expect(preview.data.workbook.sheets[0].rows[0].f_detonator_no).toBe('D-9');

    const xlsx = await exportRegisterXlsx(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/export`, 'GET'),
      context(register.id),
    );
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get('content-type')).toContain('spreadsheetml');
    expect((await xlsx.arrayBuffer()).byteLength).toBeGreaterThan(100);

    const submissionsPreview = await jsonOf(await previewSubmissionsExport(
      await requestFor(org.divisionAdmin, '/api/submissions/export/preview', 'GET'),
    ));
    expect(submissionsPreview.data.workbook.sheets.length).toBeGreaterThanOrEqual(1);
    const submissionsXlsx = await exportSubmissionsXlsx(
      await requestFor(org.divisionAdmin, '/api/submissions/export/xlsx', 'GET'),
    );
    expect(submissionsXlsx.status).toBe(200);
    expect(submissionsXlsx.headers.get('content-type')).toContain('spreadsheetml');

    const seeded = await seedClientRegistersForDivision({
      divisionId: org.ahmedabad.id,
      createdById: org.divisionAdmin.id,
    });
    expect(seeded.forms).toHaveLength(6);
    expect(seeded.results).toHaveLength(6);
    expect(seeded.results.every(item => item.mapped > 0)).toBe(true);
  });
});