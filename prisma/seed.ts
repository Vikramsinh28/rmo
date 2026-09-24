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

  console.log(`Seeded local system admin ${DEV_LOGIN_ID} / ${DEV_EMAIL}`);
  await prisma.$disconnect();
}

main().catch(async error => {
  console.error(error);
  process.exit(1);
});
