import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/lib/prisma/generated/client';
import { seedClientFormsForDivision } from '../src/services/internal/rmo/client-registers';

const DEV_EMAIL = 'vikramsinhparmar2812@gmail.com';
const DEV_PASSWORD = 'Vikram@2812';
const DEV_LOGIN_ID = 'sysadmin';

function assertLocalDevDatabase(url: string) {
  const parsed = new URL(url);
  const localHost = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  const devDatabase = parsed.pathname === '/rmo_kostra_dev';
  if (!localHost || !devDatabase) {
    throw new Error('Seed runs only against local database rmo_kostra_dev');
  }
}

async function seedCrewAndDutyTypes(prisma: PrismaClient) {
  const crewDefaults = [
    { code: 'ALP', name: 'ALP', sortOrder: 1 },
    { code: 'LP', name: 'LP', sortOrder: 2 },
    { code: 'TM', name: 'TM', sortOrder: 3 },
  ];
  for (const row of crewDefaults) {
    await prisma.crewType.upsert({
      where: { code: row.code },
      create: { ...row, isActive: true },
      update: { name: row.name, sortOrder: row.sortOrder, isActive: true },
    });
  }
  const dutyDefaults = [
    { code: 'SIGN_ON', name: 'Sign On', sortOrder: 1 },
    { code: 'SIGN_OFF', name: 'Sign Off', sortOrder: 2 },
  ];
  for (const row of dutyDefaults) {
    await prisma.dutyType.upsert({
      where: { code: row.code },
      create: { ...row, isActive: true },
      update: { name: row.name, sortOrder: row.sortOrder, isActive: true },
    });
  }
}

async function seedDemoCrewForms(
  prisma: PrismaClient,
  adminId: number,
  divisionId: number,
) {
  const alp = await prisma.crewType.findUnique({ where: { code: 'ALP' } });
  const lp = await prisma.crewType.findUnique({ where: { code: 'LP' } });
  const signOn = await prisma.dutyType.findUnique({ where: { code: 'SIGN_ON' } });
  const signOff = await prisma.dutyType.findUnique({ where: { code: 'SIGN_OFF' } });
  if (!alp || !lp || !signOn || !signOff) return;

  const demos = [
    {
      name: 'ALP Sign On Form',
      description: 'Duty checklist for ALP crew at sign on.',
      crewTypeId: alp.id,
      dutyTypeId: signOn.id,
    },
    {
      name: 'ALP Sign Off Form',
      description: 'Duty checklist for ALP crew at sign off.',
      crewTypeId: alp.id,
      dutyTypeId: signOff.id,
    },
    {
      name: 'LP Sign On Form',
      description: 'Duty checklist for LP crew at sign on.',
      crewTypeId: lp.id,
      dutyTypeId: signOn.id,
    },
  ];

  for (const demo of demos) {
    const existing = await prisma.form.findFirst({
      where: {
        divisionId,
        crewTypeId: demo.crewTypeId,
        dutyTypeId: demo.dutyTypeId,
        purpose: 'GENERAL',
      },
    });
    if (existing) continue;

    const form = await prisma.form.create({
      data: {
        name: demo.name,
        description: demo.description,
        divisionId,
        crewTypeId: demo.crewTypeId,
        dutyTypeId: demo.dutyTypeId,
        status: 'PUBLISHED',
        purpose: 'GENERAL',
        createdById: adminId,
      },
    });
    const version = await prisma.formVersion.create({
      data: {
        formId: form.id,
        versionNumber: 1,
        status: 'PUBLISHED',
        createdById: adminId,
        schema: {
          sections: ['Duty checklist'],
          fields: [
            {
              id: 'remarks',
              key: 'remarks',
              label: 'Remarks',
              type: 'TEXTAREA',
              required: false,
              placeholder: '',
              helpText: '',
              options: [],
              validation: {},
              displayOrder: 0,
              section: 'Duty checklist',
              registerId: null,
            },
            {
              id: 'confirm_ready',
              key: 'confirm_ready',
              label: 'Confirm ready for duty',
              type: 'YES_NO',
              required: true,
              placeholder: '',
              helpText: '',
              options: [],
              validation: {},
              displayOrder: 1,
              section: 'Duty checklist',
              registerId: null,
            },
          ],
        },
      },
    });
    await prisma.form.update({
      where: { id: form.id },
      data: { currentVersionId: version.id },
    });
  }
}

async function main() {
  const databaseUrl = process.env.POSTGRES_URL;
  if (!databaseUrl) {
    throw new Error('POSTGRES_URL is not set');
  }
  assertLocalDevDatabase(databaseUrl);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  await seedCrewAndDutyTypes(prisma);
  console.log('Seeded crew types ALP/LP/TM and duty types SIGN_ON/SIGN_OFF');

  const password = await bcrypt.hash(DEV_PASSWORD, 10);
  const adminData = {
    name: 'Vikram',
    email: DEV_EMAIL,
    role: 'ADMIN' as const,
    rmoRole: 'SYSTEM_ADMIN' as const,
    accountStatus: 'ACTIVE' as const,
    loginId: DEV_LOGIN_ID,
    password,
    isOnboarded: true,
  };
  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ email: DEV_EMAIL }, { email: 'dev-admin@localhost' }, { loginId: DEV_LOGIN_ID }],
    },
  });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: adminData });
  } else {
    await prisma.user.create({ data: adminData });
  }

  const admin = await prisma.user.findFirst({ where: { loginId: DEV_LOGIN_ID } });
  const enrollmentForm = await prisma.form.findFirst({ where: { purpose: 'CREW_ENROLLMENT' } });
  if (admin && !enrollmentForm) {
    const form = await prisma.form.create({
      data: {
        name: 'Crew Enrollment',
        description: 'Additional questions for a crew enrollment request.',
        purpose: 'CREW_ENROLLMENT',
        status: 'PUBLISHED',
        createdById: admin.id,
      },
    });
    const version = await prisma.formVersion.create({
      data: {
        formId: form.id,
        versionNumber: 1,
        status: 'PUBLISHED',
        createdById: admin.id,
        schema: {
          sections: ['Enrollment questions'],
          fields: [
            {
              id: 'years_of_service',
              key: 'years_of_service',
              label: 'Years of service',
              type: 'NUMBER',
              required: false,
              placeholder: '',
              helpText: '',
              options: [],
              validation: {},
              displayOrder: 0,
              section: 'Enrollment questions',
            },
            {
              id: 'remarks',
              key: 'remarks',
              label: 'Anything else the division should know',
              type: 'TEXTAREA',
              required: false,
              placeholder: '',
              helpText: '',
              options: [],
              validation: {},
              displayOrder: 1,
              section: 'Enrollment questions',
            },
          ],
        },
      },
    });
    await prisma.form.update({
      where: { id: form.id },
      data: { currentVersionId: version.id },
    });
  }

  const firstDivision = await prisma.division.findFirst({
    orderBy: { id: 'asc' },
    select: { id: true, name: true },
  });
  if (admin && firstDivision) {
    const seeded = await seedClientFormsForDivision({
      divisionId: firstDivision.id,
      createdById: admin.id,
    });
    const created = seeded.results.filter(row => row.created).length;
    console.log(
      `Seeded client forms for ${firstDivision.name}: ${seeded.results.length} forms ` +
        `(${created} new). Legacy register forms stay crewType/dutyType null (admin-only).`,
    );
    await seedDemoCrewForms(prisma, admin.id, firstDivision.id);
    console.log(`Seeded demo crew forms for ${firstDivision.name} (ALP Sign On/Off, LP Sign On).`);
  }

  console.log(`Seeded local system admin ${DEV_LOGIN_ID} / ${DEV_EMAIL}`);
  await prisma.$disconnect();
}

main().catch(async error => {
  console.error(error);
  process.exit(1);
});
