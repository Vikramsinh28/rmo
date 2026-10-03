import { GET as getForm, PATCH as updateForm } from '@/app/api/admin/forms/[id]/route';
import { POST as publishForm } from '@/app/api/admin/forms/[id]/publish/route';
import { GET as listForms, POST as createForm } from '@/app/api/admin/forms/route';
import { GET as listCrewTypes, POST as createCrewType } from '@/app/api/admin/crew-types/route';
import { PATCH as updateCrewType } from '@/app/api/admin/crew-types/[id]/route';
import { GET as listDutyTypesAdmin, POST as createDutyType } from '@/app/api/admin/duty-types/route';
import { PATCH as updateDutyType } from '@/app/api/admin/duty-types/[id]/route';
import { GET as crewDutyTypes } from '@/app/api/crew/duty-types/route';
import { GET as analyticsSubmissions } from '@/app/api/analytics/submissions/route';
import { GET as exportSubmissions } from '@/app/api/submissions/export/route';
import { POST as createSubmission } from '@/app/api/submissions/route';
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

describe('Crew form filtering by crew type and duty type', () => {
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
    const alp = await testPrisma.crewType.create({
      data: { code: 'ALP', name: 'ALP', sortOrder: 1, isActive: true },
    });
    const lp = await testPrisma.crewType.create({
      data: { code: 'LP', name: 'LP', sortOrder: 2, isActive: true },
    });
    const tm = await testPrisma.crewType.create({
      data: { code: 'TM', name: 'TM', sortOrder: 3, isActive: true },
    });
    const signOn = await testPrisma.dutyType.create({
      data: { code: 'SIGN_ON', name: 'Sign On', sortOrder: 1, isActive: true },
    });
    const signOff = await testPrisma.dutyType.create({
      data: { code: 'SIGN_OFF', name: 'Sign Off', sortOrder: 2, isActive: true },
    });
    const inactiveDuty = await testPrisma.dutyType.create({
      data: { code: 'BREAK', name: 'Break', sortOrder: 9, isActive: false },
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
    const lobby = (await jsonOf(await createLobby(await requestFor(admin, '/api/admin/lobbies', 'POST', {
      divisionId: ahmedabad.id,
      name: 'Lobby A1',
      code: 'A1',
    })))).data;
    const suratLobby = (await jsonOf(await createLobby(await requestFor(admin, '/api/admin/lobbies', 'POST', {
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

    const alpUser = await testPrisma.user.create({
      data: {
        email: 'alp@example.com',
        name: 'ALP Crew',
        loginId: 'alp-crew',
        password,
        role: 'USER',
        rmoRole: 'CREW_USER',
        isOnboarded: true,
        homeZoneId: zone.id,
        homeDivisionId: ahmedabad.id,
        homeLobbyId: lobby.id,
        crewTypeId: alp.id,
      },
    });
    const lpUser = await testPrisma.user.create({
      data: {
        email: 'lp@example.com',
        name: 'LP Crew',
        loginId: 'lp-crew',
        password,
        role: 'USER',
        rmoRole: 'CREW_USER',
        isOnboarded: true,
        homeZoneId: zone.id,
        homeDivisionId: ahmedabad.id,
        homeLobbyId: lobby.id,
        crewTypeId: lp.id,
      },
    });
    const tmUser = await testPrisma.user.create({
      data: {
        email: 'tm@example.com',
        name: 'TM Crew',
        loginId: 'tm-crew',
        password,
        role: 'USER',
        rmoRole: 'CREW_USER',
        isOnboarded: true,
        homeZoneId: zone.id,
        homeDivisionId: ahmedabad.id,
        homeLobbyId: lobby.id,
        crewTypeId: tm.id,
      },
    });

    async function publishCrewForm(
      actor: typeof divisionAdmin,
      name: string,
      crewTypeId: number,
      dutyTypeId: number,
      divisionId = ahmedabad.id,
    ) {
      const created = await jsonOf(await createForm(await requestFor(actor, '/api/admin/forms', 'POST', {
        name,
        description: name,
        schema,
        crewTypeId,
        dutyTypeId,
        divisionId: actor.rmoRole === 'SYSTEM_ADMIN' ? divisionId : undefined,
      })));
      expect(created.success).toBe(true);
      const published = await jsonOf(await publishForm(
        await requestFor(actor, `/api/admin/forms/${created.data.id}/publish`, 'POST'),
        context(created.data.id),
      ));
      expect(published.success).toBe(true);
      return published.data;
    }

    const alpSignOn = await publishCrewForm(divisionAdmin, 'ALP Sign On Form', alp.id, signOn.id);
    const alpSignOff = await publishCrewForm(divisionAdmin, 'ALP Sign Off Form', alp.id, signOff.id);
    const lpSignOn = await publishCrewForm(divisionAdmin, 'LP Sign On Form', lp.id, signOn.id);
    const tmSignOn = await publishCrewForm(divisionAdmin, 'TM Sign On Form', tm.id, signOn.id);

    return {
      admin,
      divisionAdmin,
      suratAdmin,
      alp,
      lp,
      tm,
      signOn,
      signOff,
      inactiveDuty,
      ahmedabad,
      surat,
      lobby,
      suratLobby,
      alpUser,
      lpUser,
      tmUser,
      alpSignOn,
      alpSignOff,
      lpSignOn,
      tmSignOn,
      publishCrewForm,
    };
  }

  it('filters forms by authenticated crew type and selected duty type', async () => {
    const org = await world();

    const alpOn = await jsonOf(await listForms(await requestFor(
      org.alpUser,
      `/api/admin/forms?dutyTypeId=${org.signOn.id}`,
      'GET',
    )));
    expect(alpOn.data.items.map((row: { name: string }) => row.name)).toEqual(['ALP Sign On Form']);

    const alpOff = await jsonOf(await listForms(await requestFor(
      org.alpUser,
      `/api/admin/forms?dutyTypeId=${org.signOff.id}`,
      'GET',
    )));
    expect(alpOff.data.items.map((row: { name: string }) => row.name)).toEqual(['ALP Sign Off Form']);

    const lpOn = await jsonOf(await listForms(await requestFor(
      org.lpUser,
      `/api/admin/forms?dutyTypeId=${org.signOn.id}`,
      'GET',
    )));
    expect(lpOn.data.items.map((row: { name: string }) => row.name)).toEqual(['LP Sign On Form']);

    const tmOn = await jsonOf(await listForms(await requestFor(
      org.tmUser,
      `/api/admin/forms?dutyTypeId=${org.signOn.id}`,
      'GET',
    )));
    expect(tmOn.data.items.map((row: { name: string }) => row.name)).toEqual(['TM Sign On Form']);

    const empty = await jsonOf(await listForms(await requestFor(
      org.lpUser,
      `/api/admin/forms?dutyTypeId=${org.signOff.id}`,
      'GET',
    )));
    expect(empty.data.items).toHaveLength(0);
  });

  it('denies cross-type form access and submission overrides', async () => {
    const org = await world();

    expect((await getForm(
      await requestFor(org.alpUser, `/api/admin/forms/${org.lpSignOn.id}`, 'GET'),
      context(org.lpSignOn.id),
    )).status).toBe(404);

    expect((await getForm(
      await requestFor(org.lpUser, `/api/admin/forms/${org.alpSignOn.id}`, 'GET'),
      context(org.alpSignOn.id),
    )).status).toBe(404);

    expect((await createSubmission(await requestFor(org.alpUser, '/api/submissions', 'POST', {
      formId: org.alpSignOff.id,
      dutyTypeId: org.signOn.id,
      answers: { confirm_ready: true },
    }))).status).toBe(403);

    expect((await createSubmission(await requestFor(org.alpUser, '/api/submissions', 'POST', {
      formId: org.lpSignOn.id,
      dutyTypeId: org.signOn.id,
      answers: { confirm_ready: true },
    }))).status).toBe(403);

    expect((await createSubmission(await requestFor(org.alpUser, '/api/submissions', 'POST', {
      formId: org.alpSignOn.id,
      dutyTypeId: org.signOn.id,
      crewTypeId: org.lp.id,
      answers: { confirm_ready: true },
    }))).status).toBe(403);

    expect((await createSubmission(await requestFor(org.alpUser, '/api/submissions', 'POST', {
      formId: org.alpSignOn.id,
      dutyTypeId: org.signOn.id,
      divisionId: org.surat.id,
      answers: { confirm_ready: true },
    }))).status).toBe(403);

    const ok = await jsonOf(await createSubmission(await requestFor(org.alpUser, '/api/submissions', 'POST', {
      formId: org.alpSignOn.id,
      dutyTypeId: org.signOn.id,
      answers: { confirm_ready: true },
    })));
    expect(ok.success).toBe(true);
    expect(ok.data.formVersionId).toBe(org.alpSignOn.currentVersionId);
    expect(ok.data.crewTypeId).toBe(org.alp.id);
    expect(ok.data.dutyTypeId).toBe(org.signOn.id);
    expect(ok.data.divisionId).toBe(org.ahmedabad.id);
    expect(ok.data.submittedById).toBe(org.alpUser.id);
  });

  it('hides inactive duty types and enforces division admin scope', async () => {
    const org = await world();
    const duties = await jsonOf(await crewDutyTypes(await requestFor(org.alpUser, '/api/crew/duty-types', 'GET')));
    expect(duties.data.map((row: { code: string }) => row.code).sort()).toEqual(['SIGN_OFF', 'SIGN_ON']);
    expect(duties.data.some((row: { id: number }) => row.id === org.inactiveDuty.id)).toBe(false);

    const suratForm = await org.publishCrewForm(
      org.suratAdmin,
      'Surat ALP Sign On',
      org.alp.id,
      org.signOn.id,
      org.surat.id,
    );
    expect((await getForm(
      await requestFor(org.divisionAdmin, `/api/admin/forms/${suratForm.id}`, 'GET'),
      context(suratForm.id),
    )).status).toBe(403);

    const adminList = await jsonOf(await listForms(await requestFor(
      org.admin,
      `/api/admin/forms?divisionId=${org.ahmedabad.id}&crewTypeId=${org.alp.id}`,
      'GET',
    )));
    expect(adminList.data.items.length).toBeGreaterThanOrEqual(2);
  });

  it('analytics and exports respect crew type and duty type filters', async () => {
    const org = await world();
    await createSubmission(await requestFor(org.alpUser, '/api/submissions', 'POST', {
      formId: org.alpSignOn.id,
      dutyTypeId: org.signOn.id,
      answers: { confirm_ready: true },
    }));
    await createSubmission(await requestFor(org.lpUser, '/api/submissions', 'POST', {
      formId: org.lpSignOn.id,
      dutyTypeId: org.signOn.id,
      answers: { confirm_ready: false },
    }));

    const alpAnalytics = await jsonOf(await analyticsSubmissions(await requestFor(
      org.divisionAdmin,
      `/api/analytics/submissions?crewTypeId=${org.alp.id}&dutyTypeId=${org.signOn.id}`,
      'GET',
    )));
    expect(alpAnalytics.data.metrics.total).toBe(1);

    const exportCsv = await exportSubmissions(await requestFor(
      org.divisionAdmin,
      `/api/submissions/export?crewTypeId=${org.lp.id}&dutyTypeId=${org.signOn.id}`,
      'GET',
    ));
    expect(exportCsv.status).toBe(200);
    const text = await exportCsv.text();
    expect(text).toContain('LP Sign On Form');
    expect(text).not.toContain('ALP Sign On Form');
  });

  it('allows type catalog management for system admin', async () => {
    const org = await world();
    const created = await jsonOf(await createCrewType(await requestFor(org.admin, '/api/admin/crew-types', 'POST', {
      code: 'GUARD',
      name: 'Guard',
      sortOrder: 4,
    })));
    expect(created.success).toBe(true);
    const patched = await jsonOf(await updateCrewType(
      await requestFor(org.admin, `/api/admin/crew-types/${created.data.id}`, 'PATCH', {
        isActive: false,
      }),
      context(created.data.id),
    ));
    expect(patched.data.isActive).toBe(false);

    const activeCrew = await jsonOf(await listCrewTypes(await requestFor(
      org.admin,
      '/api/admin/crew-types?activeOnly=true',
      'GET',
    )));
    expect(activeCrew.data.some((row: { code: string }) => row.code === 'GUARD')).toBe(false);

    const duty = await jsonOf(await createDutyType(await requestFor(org.admin, '/api/admin/duty-types', 'POST', {
      code: 'RELIEF',
      name: 'Relief',
    })));
    expect(duty.success).toBe(true);
    await updateDutyType(
      await requestFor(org.admin, `/api/admin/duty-types/${duty.data.id}`, 'PATCH', { name: 'Relief Duty' }),
      context(duty.data.id),
    );
    const allDuty = await jsonOf(await listDutyTypesAdmin(await requestFor(org.admin, '/api/admin/duty-types', 'GET')));
    expect(allDuty.data.some((row: { code: string }) => row.code === 'RELIEF')).toBe(true);
  });

  it('rejects a second published form for the same division+crew+duty', async () => {
    const org = await world();
    const duplicate = await jsonOf(await createForm(await requestFor(org.divisionAdmin, '/api/admin/forms', 'POST', {
      name: 'Duplicate ALP Sign On',
      schema,
      crewTypeId: org.alp.id,
      dutyTypeId: org.signOn.id,
    })));
    expect(duplicate.success).toBe(true);
    const published = await publishForm(
      await requestFor(org.divisionAdmin, `/api/admin/forms/${duplicate.data.id}/publish`, 'POST'),
      context(duplicate.data.id),
    );
    expect(published.status).toBe(409);
  });

  it('supports register mapping on questions without exposing separate crew forms', async () => {
    const org = await world();
    const register = await testPrisma.register.create({
      data: {
        name: 'Detonator Register',
        divisionId: org.ahmedabad.id,
        formId: org.alpSignOn.id,
        createdById: org.divisionAdmin.id,
      },
    });
    const draft = await jsonOf(await updateForm(
      await requestFor(org.divisionAdmin, `/api/admin/forms/${org.alpSignOn.id}`, 'PATCH', {
        schema: {
          sections: ['Duty'],
          fields: [
            {
              ...schema.fields[0],
              registerId: register.id,
            },
          ],
        },
      }),
      context(org.alpSignOn.id),
    ));
    expect(draft.success).toBe(true);
    const fields = await testPrisma.registerField.findMany({ where: { registerId: register.id } });
    expect(fields.map(field => field.fieldKey)).toEqual(['confirm_ready']);

    const listed = await jsonOf(await listForms(await requestFor(
      org.alpUser,
      `/api/admin/forms?dutyTypeId=${org.signOn.id}`,
      'GET',
    )));
    expect(listed.data.items).toHaveLength(1);
  });
});
