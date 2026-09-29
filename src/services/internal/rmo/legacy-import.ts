import { prisma } from '@/lib/prisma';
import { RmoError } from '@/lib/rmo/errors';
import type { Actor } from '@/services/internal/rmo/administration';
import { actorRole } from '@/services/internal/rmo/submission-scope';
import { recordAudit } from '@/services/internal/rmo/audit-event';
import {
  ensureCrewRegistrationForm,
} from '@/services/internal/rmo/question-configurations';

const DENIED = 'You do not have permission to perform this action.';

export interface LegacyImportPayload {
  crewTypes?: Array<{ code: string; name?: string; description?: string }>;
  dutyTypes?: Array<{ code: string; name?: string; description?: string }>;
  registerTypes?: Array<{ code: string; name?: string; description?: string }>;
  questions?: Array<{
    code: string;
    text: string;
    type?: string;
    required?: boolean;
    helpText?: string;
    registers?: string[];
  }>;
  configurations?: Array<{
    questionCode: string;
    crewTypeCode: string;
    dutyTypeCode: string;
    displayOrder?: number;
    required?: boolean;
  }>;
  users?: Array<{
    loginId: string;
    staffType?: string;
    crewTypeCode?: string;
  }>;
  submissions?: Array<{
    loginId: string;
    staffType?: string;
    crewTypeCode?: string;
    dutyType?: string;
    dutyTypeCode?: string;
    answers: Array<{ questionCode: string; answer: unknown }>;
    submittedAt?: string;
    divisionCode?: string;
    lobbyCode?: string;
  }>;
}

export type ImportBucket = 'Imported' | 'Mapped' | 'Skipped' | 'Failed' | 'Needs Review';

export interface ImportReportItem {
  bucket: ImportBucket;
  entity: string;
  key: string;
  message: string;
}

function normalizeCode(value: string | undefined) {
  return (value || '').trim().toUpperCase().replace(/\s+/g, '_');
}

export async function importLegacyCrewData(actor: Actor, payload: LegacyImportPayload) {
  if (actorRole(actor) !== 'SYSTEM_ADMIN') throw new RmoError(DENIED, 403);
  const report: ImportReportItem[] = [];
  const push = (bucket: ImportBucket, entity: string, key: string, message: string) => {
    report.push({ bucket, entity, key, message });
  };

  const form = await ensureCrewRegistrationForm(actor.id);
  if (!form.currentVersionId) throw new RmoError('Crew registration form version missing.', 500);

  for (const row of payload.crewTypes ?? []) {
    const code = normalizeCode(row.code);
    if (!code) {
      push('Failed', 'crewType', String(row.code), 'Missing code');
      continue;
    }
    const existing = await prisma.crewType.findUnique({ where: { code } });
    if (existing) {
      push('Skipped', 'crewType', code, 'Already exists');
      continue;
    }
    await prisma.crewType.create({
      data: {
        code,
        name: row.name?.trim() || code,
        description: row.description?.trim() || '',
        createdById: actor.id,
      },
    });
    push('Imported', 'crewType', code, 'Created');
  }

  for (const row of payload.dutyTypes ?? []) {
    const code = normalizeCode(row.code);
    if (!code) {
      push('Failed', 'dutyType', String(row.code), 'Missing code');
      continue;
    }
    const existing = await prisma.dutyType.findUnique({ where: { code } });
    if (existing) {
      push('Skipped', 'dutyType', code, 'Already exists');
      continue;
    }
    await prisma.dutyType.create({
      data: {
        code,
        name: row.name?.trim() || code,
        description: row.description?.trim() || '',
        createdById: actor.id,
      },
    });
    push('Imported', 'dutyType', code, 'Created');
  }

  for (const row of payload.registerTypes ?? []) {
    const code = normalizeCode(row.code);
    if (!code) {
      push('Failed', 'registerType', String(row.code), 'Missing code');
      continue;
    }
    const existing = await prisma.registerType.findUnique({ where: { code } });
    if (existing) {
      push('Skipped', 'registerType', code, 'Already exists');
      continue;
    }
    await prisma.registerType.create({
      data: {
        code,
        name: row.name?.trim() || code,
        description: row.description?.trim() || '',
        createdById: actor.id,
      },
    });
    push('Imported', 'registerType', code, 'Created');
  }

  for (const row of payload.questions ?? []) {
    const code = normalizeCode(row.code);
    if (!code || !row.text?.trim()) {
      push('Failed', 'question', String(row.code), 'Missing code or text');
      continue;
    }
    let question = await prisma.question.findUnique({ where: { code } });
    if (!question) {
      question = await prisma.question.create({
        data: {
          code,
          text: row.text.trim(),
          type: row.type || 'YES_NO',
          required: Boolean(row.required),
          helpText: row.helpText?.trim() || '',
          createdById: actor.id,
        },
      });
      push('Imported', 'question', code, 'Created');
    } else {
      push('Mapped', 'question', code, 'Reused existing question');
    }
    for (const registerCode of row.registers ?? []) {
      const regCode = normalizeCode(registerCode);
      const registerType = await prisma.registerType.findUnique({ where: { code: regCode } });
      if (!registerType) {
        push('Needs Review', 'questionRegister', `${code}->${regCode}`, 'Register type missing');
        continue;
      }
      const existing = await prisma.questionRegister.findUnique({
        where: {
          questionId_registerTypeId: {
            questionId: question.id,
            registerTypeId: registerType.id,
          },
        },
      });
      if (existing) {
        push('Skipped', 'questionRegister', `${code}->${regCode}`, 'Already mapped');
        continue;
      }
      await prisma.questionRegister.create({
        data: { questionId: question.id, registerTypeId: registerType.id },
      });
      push('Imported', 'questionRegister', `${code}->${regCode}`, 'Mapped');
    }
  }

  for (const row of payload.configurations ?? []) {
    const questionCode = normalizeCode(row.questionCode);
    const crewTypeCode = normalizeCode(row.crewTypeCode);
    const dutyTypeCode = normalizeCode(row.dutyTypeCode);
    const question = await prisma.question.findUnique({ where: { code: questionCode } });
    const crewType = await prisma.crewType.findUnique({ where: { code: crewTypeCode } });
    const dutyType = await prisma.dutyType.findUnique({ where: { code: dutyTypeCode } });
    if (!question || !crewType || !dutyType) {
      push(
        'Needs Review',
        'configuration',
        `${questionCode}/${crewTypeCode}/${dutyTypeCode}`,
        'Missing question, crew type, or duty type',
      );
      continue;
    }
    const existing = await prisma.questionConfiguration.findUnique({
      where: {
        questionId_crewTypeId_dutyTypeId_formVersionId: {
          questionId: question.id,
          crewTypeId: crewType.id,
          dutyTypeId: dutyType.id,
          formVersionId: form.currentVersionId!,
        },
      },
    });
    if (existing) {
      push('Skipped', 'configuration', questionCode, 'Already configured');
      continue;
    }
    await prisma.questionConfiguration.create({
      data: {
        questionId: question.id,
        crewTypeId: crewType.id,
        dutyTypeId: dutyType.id,
        formVersionId: form.currentVersionId!,
        displayOrder: row.displayOrder ?? 0,
        required: Boolean(row.required),
      },
    });
    push('Imported', 'configuration', questionCode, 'Configured');
  }

  for (const row of payload.users ?? []) {
    const loginId = row.loginId?.trim();
    const crewTypeCode = normalizeCode(row.crewTypeCode || row.staffType);
    if (!loginId || !crewTypeCode) {
      push('Failed', 'user', String(row.loginId), 'Missing loginId or staff type');
      continue;
    }
    const user = await prisma.user.findFirst({
      where: { loginId: { equals: loginId, mode: 'insensitive' }, deletedAt: null },
    });
    const crewType = await prisma.crewType.findUnique({ where: { code: crewTypeCode } });
    if (!user) {
      push('Needs Review', 'user', loginId, 'User not found in RMO');
      continue;
    }
    if (!crewType) {
      push('Needs Review', 'user', loginId, `Crew type ${crewTypeCode} missing`);
      continue;
    }
    if (user.crewTypeId === crewType.id) {
      push('Skipped', 'user', loginId, 'Crew type already set');
      continue;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { crewTypeId: crewType.id },
    });
    push('Mapped', 'user', loginId, `Set crew type ${crewTypeCode}`);
  }

  for (const row of payload.submissions ?? []) {
    const loginId = row.loginId?.trim();
    const crewTypeCode = normalizeCode(row.crewTypeCode || row.staffType);
    const dutyTypeCode = normalizeCode(row.dutyTypeCode || row.dutyType);
    if (!loginId || !crewTypeCode || !dutyTypeCode) {
      push('Failed', 'submission', String(row.loginId), 'Missing login, staff type, or duty');
      continue;
    }
    const user = await prisma.user.findFirst({
      where: { loginId: { equals: loginId, mode: 'insensitive' }, deletedAt: null },
    });
    const crewType = await prisma.crewType.findUnique({ where: { code: crewTypeCode } });
    const dutyType = await prisma.dutyType.findUnique({ where: { code: dutyTypeCode } });
    if (!user || !crewType || !dutyType) {
      push('Needs Review', 'submission', loginId, 'User/crew/duty not mapped');
      continue;
    }
    if (!user.homeDivisionId) {
      push('Needs Review', 'submission', loginId, 'User has no division');
      continue;
    }
    const answerRows: Array<{ questionId: number; answer: unknown; code: string }> = [];
    let failed = false;
    for (const answer of row.answers ?? []) {
      const questionCode = normalizeCode(answer.questionCode);
      const question = await prisma.question.findUnique({ where: { code: questionCode } });
      if (!question) {
        push('Needs Review', 'submissionAnswer', `${loginId}:${questionCode}`, 'Question missing');
        failed = true;
        continue;
      }
      answerRows.push({ questionId: question.id, answer: answer.answer, code: questionCode });
    }
    if (failed) continue;
    const answersJson = Object.fromEntries(answerRows.map(item => [item.code, item.answer]));
    const submission = await prisma.submission.create({
      data: {
        formId: form.id,
        formVersionId: form.currentVersionId!,
        divisionId: user.homeDivisionId,
        lobbyId: user.homeLobbyId,
        submittedById: user.id,
        status: 'COMPLETED',
        answers: answersJson as object,
        crewTypeId: crewType.id,
        crewTypeName: crewType.name,
        dutyTypeId: dutyType.id,
        dutyTypeName: dutyType.name,
        submittedAt: row.submittedAt ? new Date(row.submittedAt) : undefined,
      },
    });
    if (answerRows.length) {
      await prisma.submissionAnswer.createMany({
        data: answerRows.map(item => ({
          submissionId: submission.id,
          questionId: item.questionId,
          answer: item.answer as object,
        })),
      });
    }
    push('Imported', 'submission', String(submission.id), `Imported for ${loginId}`);
  }

  const summary = {
    Imported: report.filter(item => item.bucket === 'Imported').length,
    Mapped: report.filter(item => item.bucket === 'Mapped').length,
    Skipped: report.filter(item => item.bucket === 'Skipped').length,
    Failed: report.filter(item => item.bucket === 'Failed').length,
    'Needs Review': report.filter(item => item.bucket === 'Needs Review').length,
  };
  await recordAudit(actor.id, 'legacy_import.completed', 'legacy_import', null, summary);
  return { summary, report };
}
