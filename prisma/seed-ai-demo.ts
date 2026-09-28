import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/lib/prisma/generated/client';

// Local AI monitoring demo: one zone, one AI-enabled division, one lobby,
// a division monitor and a lobby desk user. Safe to re-run.
const DEMO_PASSWORD = 'Demo@1234';

function assertLocalDevDatabase(url: string) {
  const parsed = new URL(url);
  const localHost = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (!localHost || parsed.pathname !== '/rmo_kostra_dev') {
    throw new Error('AI demo seed runs only against local database rmo_kostra_dev');
  }
}

async function main() {
  const databaseUrl = process.env.POSTGRES_URL;
  if (!databaseUrl) throw new Error('POSTGRES_URL is not set');
  assertLocalDevDatabase(databaseUrl);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  const zone = await prisma.zone.upsert({
    where: { code: 'WR' },
    update: {},
    create: { name: 'Western Railway', code: 'WR' },
  });
  const division = await prisma.division.upsert({
    where: { zoneId_code: { zoneId: zone.id, code: 'ADI' } },
    update: {},
    create: { zoneId: zone.id, name: 'Ahmedabad', code: 'ADI' },
  });
  const entitlement = {
    enabled: true,
    plan: 'ENTERPRISE' as const,
    status: 'ACTIVE' as const,
    startsAt: new Date(),
    expiresAt: null,
    faceIdentification: true,
    fatigueDetection: true,
    impairmentDetection: true,
    behaviorMonitoring: true,
  };
  await prisma.divisionAIEntitlement.upsert({
    where: { divisionId: division.id },
    update: entitlement,
    create: { divisionId: division.id, ...entitlement },
  });
  const lobby = await prisma.lobby.upsert({
    where: { divisionId_code: { divisionId: division.id, code: 'ADI-CL' } },
    update: {},
    create: { divisionId: division.id, name: 'Ahmedabad Crew Lobby', code: 'ADI-CL' },
  });

  const password = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users = [
    {
      loginId: 'monitor',
      name: 'Demo Monitor',
      email: 'monitor@localhost',
      rmoRole: 'DIVISION_MONITOR' as const,
      homeLobbyId: null,
    },
    {
      loginId: 'lobby',
      name: 'Demo Lobby Desk',
      email: 'lobby@localhost',
      rmoRole: 'LOBBY_USER' as const,
      homeLobbyId: lobby.id,
    },
  ];
  for (const user of users) {
    const data = {
      ...user,
      password,
      role: 'USER' as const,
      accountStatus: 'ACTIVE' as const,
      isOnboarded: true,
      homeZoneId: zone.id,
      homeDivisionId: division.id,
    };
    await prisma.user.upsert({ where: { loginId: user.loginId }, update: data, create: data });
  }

  console.log(
    `Seeded AI demo: ${zone.name} / ${division.name} (AI enabled) / ${lobby.name}\n`
    + `  monitor / ${DEMO_PASSWORD}  (Division Monitor)\n`
    + `  lobby   / ${DEMO_PASSWORD}  (Lobby User)`,
  );
  await prisma.$disconnect();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
