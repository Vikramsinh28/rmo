import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/lib/prisma/generated/client';

function assertLocalDev(url: string) {
  const parsed = new URL(url);
  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (!local || parsed.pathname !== '/rmo_kostra_dev') {
    throw new Error(`Cleanup runs only against local rmo_kostra_dev. Got: ${url}`);
  }
}

async function main() {
  const databaseUrl = process.env.POSTGRES_URL;
  if (!databaseUrl) throw new Error('POSTGRES_URL is not set');
  assertLocalDev(databaseUrl);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  const keepForms = await prisma.form.findMany({
    where: {
      OR: [
        { purpose: 'CREW_ENROLLMENT' },
        {
          AND: [
            { crewTypeId: { not: null } },
            { dutyTypeId: { not: null } },
          ],
        },
      ],
    },
    select: {
      id: true,
      name: true,
      purpose: true,
      crewType: { select: { code: true } },
      dutyType: { select: { code: true } },
    },
    orderBy: { id: 'asc' },
  });
  const keepIds = new Set(keepForms.map(form => form.id));

  const deleteForms = await prisma.form.findMany({
    where: { id: { notIn: [...keepIds] } },
    select: { id: true, name: true, purpose: true, crewTypeId: true, dutyTypeId: true },
    orderBy: { id: 'asc' },
  });

  console.log('Keeping forms:');
  for (const form of keepForms) {
    console.log(
      `  #${form.id} ${form.name} [${form.purpose}]` +
        (form.crewType || form.dutyType
          ? ` ${form.crewType?.code || '-'} / ${form.dutyType?.code || '-'}`
          : ''),
    );
  }
  console.log(`Deleting ${deleteForms.length} legacy/untyped forms:`);
  for (const form of deleteForms) {
    console.log(`  #${form.id} ${form.name}`);
  }

  const deleteIds = deleteForms.map(form => form.id);

  // Delete dependent rows for forms we are removing.
  await prisma.$transaction(async tx => {
    if (deleteIds.length > 0) {
      const registers = await tx.register.findMany({
        where: { formId: { in: deleteIds } },
        select: { id: true },
      });
      const registerIds = registers.map(row => row.id);

      if (registerIds.length > 0) {
        await tx.registerField.deleteMany({ where: { registerId: { in: registerIds } } });
      }

      // Submissions on deleted forms
      const submissions = await tx.submission.findMany({
        where: { formId: { in: deleteIds } },
        select: { id: true },
      });
      const submissionIds = submissions.map(row => row.id);
      if (submissionIds.length > 0) {
        await tx.crewEnrollment.updateMany({
          where: { formSubmissionId: { in: submissionIds } },
          data: { formSubmissionId: null },
        });
        await tx.submission.deleteMany({ where: { id: { in: submissionIds } } });
      }

      await tx.register.deleteMany({ where: { formId: { in: deleteIds } } });
      await tx.formAssignment.deleteMany({ where: { formId: { in: deleteIds } } });

      // Clear currentVersion pointer before deleting versions
      await tx.form.updateMany({
        where: { id: { in: deleteIds } },
        data: { currentVersionId: null },
      });
      await tx.formVersion.deleteMany({ where: { formId: { in: deleteIds } } });
      await tx.form.deleteMany({ where: { id: { in: deleteIds } } });
    }

    // Also remove any orphan registers not tied to kept forms
    const orphanRegisters = await tx.register.findMany({
      where: keepIds.size ? { formId: { notIn: [...keepIds] } } : undefined,
      select: { id: true, name: true },
    });
    if (orphanRegisters.length > 0) {
      const orphanIds = orphanRegisters.map(row => row.id);
      await tx.registerField.deleteMany({ where: { registerId: { in: orphanIds } } });
      await tx.register.deleteMany({ where: { id: { in: orphanIds } } });
      console.log(`Deleted ${orphanRegisters.length} leftover registers.`);
    }
  });

  const remainingForms = await prisma.form.findMany({
    select: {
      id: true,
      name: true,
      purpose: true,
      crewType: { select: { code: true } },
      dutyType: { select: { code: true } },
      _count: { select: { registers: true, submissions: true } },
    },
    orderBy: { id: 'asc' },
  });
  const remainingRegisters = await prisma.register.count();

  console.log('\nRemaining forms:');
  for (const form of remainingForms) {
    console.log(
      `  #${form.id} ${form.name} [${form.purpose}]` +
        (form.crewType || form.dutyType
          ? ` ${form.crewType?.code || '-'} / ${form.dutyType?.code || '-'}`
          : '') +
        ` registers=${form._count.registers} submissions=${form._count.submissions}`,
    );
  }
  console.log(`Remaining registers: ${remainingRegisters}`);

  await prisma.$disconnect();
}

main().catch(async error => {
  console.error(error);
  process.exit(1);
});
