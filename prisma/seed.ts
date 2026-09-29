import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/lib/prisma/generated/client';

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

async function upsertMaster(
  prisma: PrismaClient,
  model: 'crewType' | 'dutyType' | 'registerType',
  code: string,
  name: string,
  description: string,
  createdById: number,
) {
  if (model === 'crewType') {
    const existing = await prisma.crewType.findUnique({ where: { code } });
    if (existing) {
      return prisma.crewType.update({
        where: { id: existing.id },
        data: { name, description, status: 'ACTIVE' },
      });
    }
    return prisma.crewType.create({
      data: { code, name, description, status: 'ACTIVE', createdById },
    });
  }
  if (model === 'dutyType') {
    const existing = await prisma.dutyType.findUnique({ where: { code } });
    if (existing) {
      return prisma.dutyType.update({
        where: { id: existing.id },
        data: { name, description, status: 'ACTIVE' },
      });
    }
    return prisma.dutyType.create({
      data: { code, name, description, status: 'ACTIVE', createdById },
    });
  }
  const existing = await prisma.registerType.findUnique({ where: { code } });
  if (existing) {
    return prisma.registerType.update({
      where: { id: existing.id },
      data: { name, description, status: 'ACTIVE' },
    });
  }
  return prisma.registerType.create({
    data: { code, name, description, status: 'ACTIVE', createdById },
  });
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
  if (!admin) throw new Error('System admin was not seeded');

  await upsertMaster(prisma, 'crewType', 'ALP', 'ALP', 'Assistant Loco Pilot', admin.id);
  await upsertMaster(prisma, 'crewType', 'LP', 'LP', 'Loco Pilot', admin.id);
  await upsertMaster(prisma, 'crewType', 'TM', 'TM', 'Train Manager', admin.id);
  await upsertMaster(prisma, 'dutyType', 'SIGN_ON', 'Sign On', 'Sign-on duty context', admin.id);
  await upsertMaster(prisma, 'dutyType', 'SIGN_OFF', 'Sign Off', 'Sign-off duty context', admin.id);
  await upsertMaster(
    prisma,
    'registerType',
    'DETONATOR',
    'Detonator',
    'Detonator register classification',
    admin.id,
  );

  const enrollmentForm = await prisma.form.findFirst({ where: { purpose: 'CREW_ENROLLMENT' } });
  if (!enrollmentForm) {
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

  let crewForm = await prisma.form.findFirst({
    where: { purpose: 'CREW_REGISTRATION' },
    include: { currentVersion: true },
  });
  if (!crewForm) {
    crewForm = await prisma.form.create({
      data: {
        name: 'Crew Registration',
        description: 'Single crew registration form resolved by crew type and duty type.',
        purpose: 'CREW_REGISTRATION',
        status: 'PUBLISHED',
        createdById: admin.id,
      },
      include: { currentVersion: true },
    });
    const version = await prisma.formVersion.create({
      data: {
        formId: crewForm.id,
        versionNumber: 1,
        status: 'PUBLISHED',
        createdById: admin.id,
        schema: { sections: ['Questions'], fields: [] },
      },
    });
    crewForm = await prisma.form.update({
      where: { id: crewForm.id },
      data: { currentVersionId: version.id },
      include: { currentVersion: true },
    });
  }

  console.log(`Seeded local system admin ${DEV_LOGIN_ID} / ${DEV_EMAIL}`);
  console.log('Seeded crew types ALP/LP/TM, duty types SIGN_ON/SIGN_OFF, register DETONATOR');
  console.log(`Crew registration form id=${crewForm.id}`);
  await prisma.$disconnect();
}

main().catch(async error => {
  console.error(error);
  process.exit(1);
});
