import { POST as publishForm } from '@/app/api/admin/forms/[id]/publish/route';
import { GET as listForms, POST as createForm } from '@/app/api/admin/forms/route';
import { GET as registerAnalytics } from '@/app/api/admin/registers/[id]/analytics/route';
import { GET as listRegisterEntries } from '@/app/api/admin/registers/[id]/entries/route';
import {
  GET as exportRegister,
} from '@/app/api/admin/registers/[id]/export/route';
import { GET as previewRegisterExport } from '@/app/api/admin/registers/[id]/export/preview/route';
import {
  DELETE as deleteRegisterField,
  PATCH as patchRegisterField,
} from '@/app/api/admin/registers/[id]/fields/[mappingId]/route';
import {
  GET as listRegisterFields,
  POST as postRegisterFields,
  PUT as replaceRegisterFields,
} from '@/app/api/admin/registers/[id]/fields/route';
import { GET as getRegister, PATCH as updateRegister } from '@/app/api/admin/registers/[id]/route';
import { GET as questionOptions } from '@/app/api/admin/registers/question-options/route';
import { GET as listRegisters, POST as createRegister } from '@/app/api/admin/registers/route';
import { POST as createDivision } from '@/app/api/admin/divisions/route';
import { POST as createLobby } from '@/app/api/admin/lobbies/route';
import { POST as createZone } from '@/app/api/admin/zones/route';
import { POST as createSubmission } from '@/app/api/submissions/route';
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

function field(
  id: string,
  label: string,
  type: string = 'TEXT',
  options: string[] = [],
) {
  return {
    id,
    key: id,
    label,
    type,
    required: false,
    placeholder: '',
    helpText: '',
    options,
    validation: {},
    displayOrder: 0,
    section: 'General',
  };
}

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

function mappingContext(id: number, mappingId: number) {
  return {
    params: Promise.resolve({ id: String(id), mappingId: String(mappingId) }),
  };
}

async function jsonOf(response: Response) {
  return response.json() as Promise<{ success: boolean; message?: string; data?: any }>;
}

describe('Register management', () => {
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
        email: 'sys@example.com',
        name: 'System',
        loginId: 'sys',
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
    const lobby = (await jsonOf(await createLobby(await requestFor(admin, '/api/admin/lobbies', 'POST', {
      divisionId: ahmedabad.id,
      name: 'Botad',
      code: 'BTD',
    })))).data;
    const suratLobby = (await jsonOf(await createLobby(await requestFor(admin, '/api/admin/lobbies', 'POST', {
      divisionId: surat.id,
      name: 'Surat Lobby',
      code: 'ST1',
    })))).data;

    const alp = await testPrisma.crewType.create({
      data: { code: 'ALP', name: 'Assistant Loco Pilot', sortOrder: 1 },
    });
    const lp = await testPrisma.crewType.create({
      data: { code: 'LP', name: 'Loco Pilot', sortOrder: 2 },
    });
    const tm = await testPrisma.crewType.create({
      data: { code: 'TM', name: 'Train Manager', sortOrder: 3 },
    });
    const signOn = await testPrisma.dutyType.create({
      data: { code: 'SIGN_ON', name: 'Sign On', sortOrder: 1 },
    });
    const signOff = await testPrisma.dutyType.create({
      data: { code: 'SIGN_OFF', name: 'Sign Off', sortOrder: 2 },
    });

    const divisionAdmin = await testPrisma.user.create({
      data: {
        email: 'adi-admin@example.com',
        name: 'ADI Admin',
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
        name: 'ST Admin',
        loginId: 'st-admin',
        password,
        role: 'USER',
        rmoRole: 'DIVISION_ADMIN',
        isOnboarded: true,
        homeZoneId: zone.id,
        homeDivisionId: surat.id,
      },
    });
    const monitor = await testPrisma.user.create({
      data: {
        email: 'adi-mon@example.com',
        name: 'ADI Monitor',
        loginId: 'adi-mon',
        password,
        role: 'USER',
        rmoRole: 'DIVISION_MONITOR',
        isOnboarded: true,
        homeZoneId: zone.id,
        homeDivisionId: ahmedabad.id,
      },
    });
    const lobbyUser = await testPrisma.user.create({
      data: {
        email: 'lobby@example.com',
        name: 'Lobby User',
        loginId: 'lobby-user',
        password,
        role: 'USER',
        rmoRole: 'LOBBY_USER',
        isOnboarded: true,
        homeZoneId: zone.id,
        homeDivisionId: ahmedabad.id,
        homeLobbyId: lobby.id,
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

    async function publishFormFor(
      name: string,
      crewTypeId: number,
      dutyTypeId: number,
      fields: ReturnType<typeof field>[],
      actor = divisionAdmin,
      divisionId = ahmedabad.id,
    ) {
      const created = await jsonOf(await createForm(await requestFor(actor, '/api/admin/forms', 'POST', {
        name,
        schema: { sections: ['General'], fields },
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
      await testPrisma.formAssignment.create({
        data: { formId: created.data.id, divisionId, lobbyId: divisionId === ahmedabad.id ? lobby.id : suratLobby.id },
      });
      return published.data as {
        id: number;
        currentVersionId: number;
        name: string;
        crewTypeId: number;
        dutyTypeId: number;
      };
    }

    const alpOff = await publishFormFor('ALP Sign Off', alp.id, signOff.id, [
      field('train_no', 'Train Number'),
      field('det_issued', 'Detonator Issued', 'NUMBER'),
      field('det_returned', 'Detonator Returned', 'NUMBER'),
      field('brake_van', 'Brake Van'),
      field('safety_eq', 'Safety Equipment', 'YES_NO'),
    ]);
    const alpOn = await publishFormFor('ALP Sign On', alp.id, signOn.id, [
      field('ready', 'Ready', 'YES_NO'),
      field('kit_ok', 'Kit OK', 'YES_NO'),
    ]);
    const lpOff = await publishFormFor('LP Sign Off', lp.id, signOff.id, [
      field('train_no', 'Train Number'),
      field('det_returned', 'Detonator Returned', 'NUMBER'),
    ]);
    const tmOn = await publishFormFor('TM Sign On', tm.id, signOn.id, [
      field('safety_checked', 'Safety Equipment Checked', 'YES_NO'),
    ]);

    return {
      admin,
      divisionAdmin,
      suratAdmin,
      monitor,
      lobbyUser,
      alpUser,
      lpUser,
      alp,
      lp,
      tm,
      signOn,
      signOff,
      ahmedabad,
      surat,
      lobby,
      suratLobby,
      alpOff,
      alpOn,
      lpOff,
      tmOn,
      publishFormFor,
    };
  }

  it('creates registers with division isolation and rejects duplicates', async () => {
    const org = await world();
    const created = await jsonOf(await createRegister(await requestFor(org.divisionAdmin, '/api/admin/registers', 'POST', {
      name: 'Detonator Register',
      description: 'Detonator book',
    })));
    expect(created.success).toBe(true);
    expect(created.data.formId).toBeNull();
    expect(created.data.divisionId).toBe(org.ahmedabad.id);

    const duplicate = await createRegister(await requestFor(org.divisionAdmin, '/api/admin/registers', 'POST', {
      name: 'detonator register',
    }));
    expect(duplicate.status).toBe(409);

    const cross = await createRegister(await requestFor(org.divisionAdmin, '/api/admin/registers', 'POST', {
      name: 'Other Division Book',
      divisionId: org.surat.id,
    }));
    expect(cross.status).toBe(403);

    const asCrew = await createRegister(await requestFor(org.alpUser, '/api/admin/registers', 'POST', {
      name: 'Crew Book',
    }));
    expect(asCrew.status).toBe(403);

    const asLobby = await createRegister(await requestFor(org.lobbyUser, '/api/admin/registers', 'POST', {
      name: 'Lobby Book',
    }));
    expect(asLobby.status).toBe(403);
  });

  it('maps questions across staff/duty contexts and rejects invalid/duplicate mappings', async () => {
    const org = await world();
    const register = (await jsonOf(await createRegister(await requestFor(org.divisionAdmin, '/api/admin/registers', 'POST', {
      name: 'Detonator Register',
    })))).data;

    const options = await jsonOf(await questionOptions(await requestFor(
      org.divisionAdmin,
      `/api/admin/registers/question-options?divisionId=${org.ahmedabad.id}&crewTypeId=${org.alp.id}&dutyTypeId=${org.signOff.id}`,
      'GET',
    )));
    expect(options.data.items.some((item: { fieldKey: string }) => item.fieldKey === 'train_no')).toBe(true);

    const add = async (form: typeof org.alpOff, fieldId: string, columnLabel?: string) =>
      jsonOf(await postRegisterFields(
        await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/fields`, 'POST', {
          formId: form.id,
          formVersionId: form.currentVersionId,
          fieldId,
          columnLabel,
        }),
        context(register.id),
      ));

    const train = await add(org.alpOff, 'train_no', 'Train No.');
    expect(train.success).toBe(true);
    expect(train.data.fields).toHaveLength(1);

    const issued = await add(org.alpOff, 'det_issued', 'Issued');
    expect(issued.success).toBe(true);
    const returned = await add(org.alpOff, 'det_returned', 'Returned');
    expect(returned.success).toBe(true);
    const lpReturned = await add(org.lpOff, 'det_returned', 'LP Returned');
    expect(lpReturned.success).toBe(true);
    const tmSafety = await add(org.tmOn, 'safety_checked');
    expect(tmSafety.success).toBe(true);
    expect(tmSafety.data.fields).toHaveLength(5);

    const duplicate = await postRegisterFields(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/fields`, 'POST', {
        formId: org.alpOff.id,
        formVersionId: org.alpOff.currentVersionId,
        fieldId: 'train_no',
      }),
      context(register.id),
    );
    expect(duplicate.status).toBe(409);

    const badVersion = await postRegisterFields(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/fields`, 'POST', {
        formId: org.alpOff.id,
        formVersionId: 999999,
        fieldId: 'train_no',
      }),
      context(register.id),
    );
    expect(badVersion.status).toBe(400);

    const badQuestion = await postRegisterFields(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/fields`, 'POST', {
        formId: org.alpOff.id,
        formVersionId: org.alpOff.currentVersionId,
        fieldId: 'missing_q',
      }),
      context(register.id),
    );
    expect(badQuestion.status).toBe(400);

    const foreignForm = await org.publishFormFor(
      'Surat ALP Off',
      org.alp.id,
      org.signOff.id,
      [field('train_no', 'Train Number')],
      org.suratAdmin,
      org.surat.id,
    );
    const foreignMap = await postRegisterFields(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/fields`, 'POST', {
        formId: foreignForm.id,
        formVersionId: foreignForm.currentVersionId,
        fieldId: 'train_no',
      }),
      context(register.id),
    );
    expect(foreignMap.status).toBe(403);

    const mappingId = tmSafety.data.fields.find((row: { fieldKey: string }) => row.fieldKey === 'safety_checked').id;
    const renamed = await jsonOf(await patchRegisterField(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/fields/${mappingId}`, 'PATCH', {
        columnLabel: 'Safety OK',
        isKeyField: true,
      }),
      mappingContext(register.id, mappingId),
    ));
    expect(renamed.data.fields.find((row: { id: number }) => row.id === mappingId).columnLabel).toBe('Safety OK');

    const orderedIds = renamed.data.fields.map((row: { id: number }) => row.id).reverse();
    const reordered = await jsonOf(await postRegisterFields(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/fields`, 'POST', {
        action: 'reorder',
        orderedIds,
      }),
      context(register.id),
    ));
    expect(reordered.data.fields.map((row: { id: number }) => row.id)).toEqual(orderedIds);

    const removed = await jsonOf(await deleteRegisterField(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/fields/${mappingId}`, 'DELETE'),
      mappingContext(register.id, mappingId),
    ));
    expect(removed.data.fields.some((row: { id: number }) => row.id === mappingId)).toBe(false);
  });

  it('shows the same submission in multiple registers and preserves version mappings', async () => {
    const org = await world();
    const detonator = (await jsonOf(await createRegister(await requestFor(org.divisionAdmin, '/api/admin/registers', 'POST', {
      name: 'Detonator Register',
    })))).data;
    const train = (await jsonOf(await createRegister(await requestFor(org.divisionAdmin, '/api/admin/registers', 'POST', {
      name: 'Train Register',
    })))).data;

    for (const [registerId, fieldId, label] of [
      [detonator.id, 'det_issued', 'Issued'],
      [detonator.id, 'det_returned', 'Returned'],
      [train.id, 'train_no', 'Train Number'],
    ] as const) {
      const mapped = await postRegisterFields(
        await requestFor(org.divisionAdmin, `/api/admin/registers/${registerId}/fields`, 'POST', {
          formId: org.alpOff.id,
          formVersionId: org.alpOff.currentVersionId,
          fieldId,
          columnLabel: label,
          isKeyField: fieldId !== 'train_no' ? fieldId === 'det_issued' : true,
        }),
        context(registerId),
      );
      expect(mapped.status).toBe(201);
    }

    const submission = await jsonOf(await createSubmission(await requestFor(org.alpUser, '/api/submissions', 'POST', {
      formId: org.alpOff.id,
      dutyTypeId: org.signOff.id,
      answers: {
        train_no: '12901',
        det_issued: 2,
        det_returned: 2,
        brake_van: 'BV-1',
        safety_eq: true,
      },
    })));
    expect(submission.success).toBe(true);

    const detonatorEntries = await jsonOf(await listRegisterEntries(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${detonator.id}/entries`, 'GET'),
      context(detonator.id),
    ));
    expect(detonatorEntries.data.total).toBe(1);
    expect(detonatorEntries.data.entries[0].submissionId).toBe(submission.data.id);
    expect(detonatorEntries.data.entries[0].values.det_issued).toBe('2');
    expect(detonatorEntries.data.entries[0].values.det_returned).toBe('2');
    expect(detonatorEntries.data.entries[0].values.train_no).toBeUndefined();

    const trainEntries = await jsonOf(await listRegisterEntries(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${train.id}/entries`, 'GET'),
      context(train.id),
    ));
    expect(trainEntries.data.total).toBe(1);
    expect(trainEntries.data.entries[0].submissionId).toBe(submission.data.id);
    expect(trainEntries.data.entries[0].values.train_no).toBe('12901');

    const v1 = org.alpOff.currentVersionId;
    const draft = await testPrisma.formVersion.create({
      data: {
        formId: org.alpOff.id,
        versionNumber: 2,
        status: 'DRAFT',
        schema: {
          sections: ['General'],
          fields: [
            field('train_no', 'Train Number v2'),
            field('det_issued', 'Detonator Issued v2', 'NUMBER'),
            field('det_returned', 'Detonator Returned v2', 'NUMBER'),
            field('new_q', 'New Question'),
          ],
        },
        createdById: org.divisionAdmin.id,
      },
    });
    await testPrisma.formVersion.update({
      where: { id: draft.id },
      data: { status: 'PUBLISHED' },
    });
    await testPrisma.form.update({
      where: { id: org.alpOff.id },
      data: { currentVersionId: draft.id },
    });

    const stillMapped = await testPrisma.registerField.findMany({
      where: { registerId: detonator.id },
    });
    expect(stillMapped.every(row => row.formVersionId === v1)).toBe(true);

    const afterPublish = await jsonOf(await listRegisterEntries(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${detonator.id}/entries`, 'GET'),
      context(detonator.id),
    ));
    expect(afterPublish.data.total).toBe(1);
    expect(afterPublish.data.entries[0].values.det_issued).toBe('2');
  });

  it('applies shared filters to entries, analytics, and export', async () => {
    const org = await world();
    const register = (await jsonOf(await createRegister(await requestFor(org.divisionAdmin, '/api/admin/registers', 'POST', {
      name: 'Detonator Register',
    })))).data;
    await postRegisterFields(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/fields`, 'POST', {
        formId: org.alpOff.id,
        formVersionId: org.alpOff.currentVersionId,
        fieldId: 'det_issued',
        isKeyField: true,
      }),
      context(register.id),
    );
    await postRegisterFields(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/fields`, 'POST', {
        formId: org.alpOff.id,
        formVersionId: org.alpOff.currentVersionId,
        fieldId: 'det_returned',
      }),
      context(register.id),
    );

    await createSubmission(await requestFor(org.alpUser, '/api/submissions', 'POST', {
      formId: org.alpOff.id,
      dutyTypeId: org.signOff.id,
      answers: { train_no: '12901', det_issued: 2, det_returned: 2 },
    }));
    await createSubmission(await requestFor(org.lpUser, '/api/submissions', 'POST', {
      formId: org.lpOff.id,
      dutyTypeId: org.signOff.id,
      answers: { train_no: '12903', det_returned: 1 },
    }));

    const filter = `crewTypeId=${org.alp.id}&dutyTypeId=${org.signOff.id}&lobbyId=${org.lobby.id}`;
    const entries = await jsonOf(await listRegisterEntries(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/entries?${filter}`, 'GET'),
      context(register.id),
    ));
    expect(entries.data.total).toBe(1);
    expect(entries.data.entries[0].crewType.code).toBe('ALP');

    const analytics = await jsonOf(await registerAnalytics(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/analytics?${filter}`, 'GET'),
      context(register.id),
    ));
    expect(analytics.data.metrics.total).toBe(1);
    expect(analytics.data.byCrewType[0].label).toBe('ALP');
    expect(analytics.data.fieldStats.numeric.length).toBeGreaterThan(0);

    const preview = await jsonOf(await previewRegisterExport(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/export/preview?${filter}`, 'GET'),
      context(register.id),
    ));
    expect(preview.data.workbook.sheets[0].row_count).toBe(1);

    const csv = await exportRegister(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/export?${filter}&format=csv`, 'GET'),
      context(register.id),
    );
    expect(csv.status).toBe(200);
    const csvText = await csv.text();
    expect(csvText).toContain('Issued');
    expect(csvText).toContain('alp-crew');
    expect(csvText.split('\n').some(line => line.startsWith('lp-crew,'))).toBe(false);

    const foreign = await listRegisterEntries(
      await requestFor(org.suratAdmin, `/api/admin/registers/${register.id}/entries`, 'GET'),
      context(register.id),
    );
    expect(foreign.status).toBe(403);

    const monitorRead = await listRegisterEntries(
      await requestFor(org.monitor, `/api/admin/registers/${register.id}/entries`, 'GET'),
      context(register.id),
    );
    expect(monitorRead.status).toBe(200);

    const monitorWrite = await postRegisterFields(
      await requestFor(org.monitor, `/api/admin/registers/${register.id}/fields`, 'POST', {
        formId: org.alpOff.id,
        formVersionId: org.alpOff.currentVersionId,
        fieldId: 'train_no',
      }),
      context(register.id),
    );
    expect(monitorWrite.status).toBe(403);

    const disabled = await jsonOf(await updateRegister(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}`, 'PATCH', {
        status: 'INACTIVE',
      }),
      context(register.id),
    ));
    expect(disabled.data.status).toBe('INACTIVE');

    const listed = await jsonOf(await listRegisters(await requestFor(
      org.admin,
      `/api/admin/registers?divisionId=${org.ahmedabad.id}`,
      'GET',
    )));
    expect(listed.data.items.some((row: { id: number }) => row.id === register.id)).toBe(true);

    const fields = await jsonOf(await listRegisterFields(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/fields`, 'GET'),
      context(register.id),
    ));
    expect(fields.data.fields.length).toBe(2);

    const replaced = await replaceRegisterFields(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}/fields`, 'PUT', {
        fields: [
          {
            formId: org.alpOff.id,
            formVersionId: org.alpOff.currentVersionId,
            fieldId: 'det_issued',
            isKeyField: true,
          },
        ],
      }),
      context(register.id),
    );
    expect(replaced.status).toBe(200);
    const replacedBody = await jsonOf(replaced);
    expect(replacedBody.data.fields).toHaveLength(1);

    const got = await jsonOf(await getRegister(
      await requestFor(org.divisionAdmin, `/api/admin/registers/${register.id}`, 'GET'),
      context(register.id),
    ));
    expect(got.data.name).toBe('Detonator Register');

    const formsStillOne = await jsonOf(await listForms(await requestFor(
      org.alpUser,
      `/api/admin/forms?dutyTypeId=${org.signOff.id}`,
      'GET',
    )));
    expect(formsStillOne.data.items).toHaveLength(1);
  });
});
