import { prisma } from '@/lib/prisma';
import { Prisma, SubmissionStatus } from '@/lib/prisma/generated/client';
import { FormSchemaError, parseFormSchema, validateAnswers } from '@/lib/rmo/form-schema';
import { RmoError } from '@/lib/rmo/errors';
import type { Actor } from '@/services/internal/rmo/administration';
import { recordAudit } from '@/services/internal/rmo/audit-event';
import {
  resolveCrewFormQuestions,
  validateCrewAnswers,
} from '@/services/internal/rmo/question-configurations';
import {
  actorRole,
  assertAnalyticsReader,
  assertSubmitter,
  assignedFormIds,
  buildSubmissionWhere,
  type SubmissionFilter,
} from '@/services/internal/rmo/submission-scope';

const DENIED = 'You do not have permission to perform this action.';

const answerSelect = {
  id: true,
  questionId: true,
  answer: true,
  question: {
    select: {
      id: true,
      code: true,
      text: true,
      type: true,
      registers: {
        select: {
          registerTypeId: true,
          registerType: { select: { id: true, code: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.SubmissionAnswerSelect;

const submissionSelect = {
  id: true,
  formId: true,
  formVersionId: true,
  divisionId: true,
  lobbyId: true,
  submittedById: true,
  submittedAt: true,
  status: true,
  answers: true,
  crewTypeId: true,
  crewTypeName: true,
  dutyTypeId: true,
  dutyTypeName: true,
  form: { select: { id: true, name: true, description: true, purpose: true } },
  formVersion: { select: { id: true, versionNumber: true, status: true, schema: true } },
  division: { select: { id: true, name: true, code: true, zoneId: true } },
  lobby: { select: { id: true, name: true, code: true } },
  submittedBy: {
    select: {
      id: true,
      name: true,
      loginId: true,
      crewTypeId: true,
      crewType: { select: { id: true, code: true, name: true } },
    },
  },
  crewType: { select: { id: true, code: true, name: true } },
  dutyType: { select: { id: true, code: true, name: true } },
  answerRows: { select: answerSelect },
} satisfies Prisma.SubmissionSelect;

function present(
  row: Prisma.SubmissionGetPayload<{ select: typeof submissionSelect }>,
  includeSchema: boolean,
  registerTypeId?: number,
) {
  let answerRows = row.answerRows;
  if (registerTypeId != null) {
    answerRows = answerRows.filter(answer =>
      answer.question.registers.some(reg => reg.registerTypeId === registerTypeId),
    );
  }
  return {
    id: row.id,
    formId: row.formId,
    formVersionId: row.formVersionId,
    divisionId: row.divisionId,
    lobbyId: row.lobbyId,
    submittedById: row.submittedById,
    submittedAt: row.submittedAt,
    status: row.status,
    answers: row.answers,
    crewTypeId: row.crewTypeId,
    crewTypeName: row.crewTypeName,
    dutyTypeId: row.dutyTypeId,
    dutyTypeName: row.dutyTypeName,
    form: row.form,
    division: row.division,
    lobby: row.lobby,
    submittedBy: row.submittedBy,
    crewType: row.crewType,
    dutyType: row.dutyType,
    answerRows,
    formVersion: {
      id: row.formVersion.id,
      versionNumber: row.formVersion.versionNumber,
      status: row.formVersion.status,
      ...(includeSchema
        ? {
            schema:
              row.form.purpose === 'CREW_REGISTRATION'
                ? {
                    sections: ['Questions'],
                    fields: answerRows.map((answer, index) => ({
                      id: String(answer.questionId),
                      key: answer.question.code,
                      label: answer.question.text,
                      type: answer.question.type,
                      required: false,
                      placeholder: '',
                      helpText: '',
                      options: [],
                      validation: {},
                      displayOrder: index,
                      section: 'Questions',
                    })),
                  }
                : parseFormSchema(row.formVersion.schema),
          }
        : {}),
    },
  };
}

function assertListRole(actor: Actor) {
  const role = actorRole(actor);
  if (
    role === 'SYSTEM_ADMIN' ||
    role === 'DIVISION_ADMIN' ||
    role === 'DIVISION_MONITOR' ||
    role === 'LOBBY_USER' ||
    role === 'CREW_USER'
  ) {
    if (role !== 'SYSTEM_ADMIN' && !actor.homeDivisionId) throw new RmoError(DENIED, 403);
    if ((role === 'LOBBY_USER' || role === 'CREW_USER') && !actor.homeLobbyId) {
      throw new RmoError(DENIED, 403);
    }
    return role;
  }
  throw new RmoError(DENIED, 403);
}

async function loadInScope(actor: Actor, id: number) {
  assertListRole(actor);
  const row = await prisma.submission.findUnique({ where: { id }, select: submissionSelect });
  if (!row) throw new RmoError('Submission not found.', 404);
  const role = actorRole(actor);
  if (role !== 'SYSTEM_ADMIN' && row.divisionId !== actor.homeDivisionId) {
    throw new RmoError(DENIED, 403);
  }
  if (role === 'LOBBY_USER' && row.lobbyId !== actor.homeLobbyId) {
    throw new RmoError(DENIED, 403);
  }
  if (role === 'CREW_USER' && row.submittedById !== actor.id) {
    throw new RmoError(DENIED, 403);
  }
  return row;
}

export async function listSubmissions(actor: Actor, filter: SubmissionFilter) {
  assertListRole(actor);
  const page = Math.max(filter.page || 1, 1);
  const pageSize = Math.min(Math.max(filter.pageSize || 20, 1), 50);
  const { where } = await buildSubmissionWhere(actor, filter);
  const [rows, total] = await Promise.all([
    prisma.submission.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: submissionSelect,
    }),
    prisma.submission.count({ where }),
  ]);
  return {
    items: rows.map(row => present(row, false)),
    total,
    page,
    pageSize,
  };
}

export async function getSubmission(
  actor: Actor,
  id: number,
  options?: { registerTypeId?: number },
) {
  if (!Number.isInteger(id)) throw new RmoError('Submission not found.', 404);
  return present(await loadInScope(actor, id), true, options?.registerTypeId);
}

export async function createSubmission(
  actor: Actor,
  input: {
    formId?: number;
    answers?: unknown;
    divisionId?: number;
    lobbyId?: number;
    dutyTypeId?: number;
    crewTypeId?: number;
    registerId?: number;
  },
) {
  assertSubmitter(actor);
  if (input.divisionId != null && input.divisionId !== actor.homeDivisionId) {
    throw new RmoError(DENIED, 403);
  }
  if (input.lobbyId != null && input.lobbyId !== actor.homeLobbyId) {
    throw new RmoError(DENIED, 403);
  }
  if (input.crewTypeId != null && input.crewTypeId !== actor.crewTypeId) {
    throw new RmoError(DENIED, 403);
  }
  if (input.registerId != null) {
    throw new RmoError('Register is not selected at submission time.', 400);
  }

  if (input.dutyTypeId != null) {
    return createCrewRegistrationSubmission(actor, input);
  }

  if (input.formId == null || !Number.isInteger(input.formId)) {
    throw new RmoError('A form is required.', 400);
  }
  const allowed = await assignedFormIds(actor);
  if (!allowed.includes(input.formId)) throw new RmoError(DENIED, 403);
  const form = await prisma.form.findUnique({
    where: { id: input.formId },
    include: { currentVersion: true },
  });
  if (!form || form.status !== 'PUBLISHED' || !form.currentVersion) {
    throw new RmoError('This form is not open for submission.', 400);
  }
  if (form.purpose === 'CREW_REGISTRATION') {
    return createCrewRegistrationSubmission(actor, { ...input, formId: form.id });
  }
  if (form.currentVersion.status !== 'PUBLISHED') {
    throw new RmoError('This form is not open for submission.', 400);
  }
  let answers;
  try {
    answers = validateAnswers(parseFormSchema(form.currentVersion.schema), input.answers ?? {});
  } catch (error) {
    if (error instanceof FormSchemaError) throw new RmoError(error.message, 400);
    throw error;
  }
  const submission = await prisma.submission.create({
    data: {
      formId: form.id,
      formVersionId: form.currentVersion.id,
      divisionId: actor.homeDivisionId as number,
      lobbyId: actor.homeLobbyId,
      submittedById: actor.id,
      status: 'COMPLETED',
      answers: answers as unknown as Prisma.InputJsonValue,
    },
    select: submissionSelect,
  });
  await recordAudit(actor.id, 'submission.created', 'submission', submission.id, {
    divisionId: submission.divisionId,
    lobbyId: submission.lobbyId,
    formId: submission.formId,
    formVersionId: submission.formVersionId,
    status: submission.status,
  });
  return present(submission, true);
}

async function createCrewRegistrationSubmission(
  actor: Actor,
  input: { answers?: unknown; dutyTypeId?: number; formId?: number },
) {
  if (actor.rmoRole !== 'CREW_USER') {
    throw new RmoError('Only a crew user can submit crew registration.', 403);
  }
  if (actor.crewTypeId == null) {
    throw new RmoError('Your account has no crew type assigned. Contact an administrator.', 400);
  }
  if (input.dutyTypeId == null || !Number.isInteger(input.dutyTypeId)) {
    throw new RmoError('Duty type is required.', 400);
  }
  const [crewType, dutyType] = await Promise.all([
    prisma.crewType.findUnique({ where: { id: actor.crewTypeId } }),
    prisma.dutyType.findUnique({ where: { id: input.dutyTypeId } }),
  ]);
  if (!crewType || crewType.status !== 'ACTIVE') {
    throw new RmoError('Crew type is inactive. Contact an administrator.', 400);
  }
  if (!dutyType || dutyType.status !== 'ACTIVE') {
    throw new RmoError('Duty type was not found or is inactive.', 400);
  }

  const resolved = await resolveCrewFormQuestions({
    crewTypeId: crewType.id,
    dutyTypeId: dutyType.id,
  });
  if (!resolved.schema.fields.length) {
    throw new RmoError('No questions are configured for your crew type and duty type.', 400);
  }
  const { answerMap, rows } = validateCrewAnswers(resolved.schema, input.answers ?? {});

  const submission = await prisma.$transaction(async tx => {
    const created = await tx.submission.create({
      data: {
        formId: resolved.form.id,
        formVersionId: resolved.formVersionId,
        divisionId: actor.homeDivisionId as number,
        lobbyId: actor.homeLobbyId,
        submittedById: actor.id,
        status: 'COMPLETED',
        answers: answerMap as unknown as Prisma.InputJsonValue,
        crewTypeId: crewType.id,
        crewTypeName: crewType.name,
        dutyTypeId: dutyType.id,
        dutyTypeName: dutyType.name,
      },
      select: { id: true },
    });
    if (rows.length) {
      await tx.submissionAnswer.createMany({
        data: rows.map(row => ({
          submissionId: created.id,
          questionId: row.questionId,
          answer: row.answer as Prisma.InputJsonValue,
        })),
      });
    }
    return tx.submission.findUniqueOrThrow({
      where: { id: created.id },
      select: submissionSelect,
    });
  });

  await recordAudit(actor.id, 'submission.created', 'submission', submission.id, {
    divisionId: submission.divisionId,
    lobbyId: submission.lobbyId,
    formId: submission.formId,
    formVersionId: submission.formVersionId,
    crewTypeId: submission.crewTypeId,
    dutyTypeId: submission.dutyTypeId,
    status: submission.status,
  });
  return present(submission, true);
}

export async function updateSubmission(
  actor: Actor,
  id: number,
  input: { status?: string },
) {
  assertAnalyticsReader(actor);
  const existing = await loadInScope(actor, id);
  if (input.status !== 'PENDING' && input.status !== 'COMPLETED') {
    throw new RmoError('Status must be PENDING or COMPLETED.', 400);
  }
  if (input.status === existing.status) return present(existing, true);
  const submission = await prisma.submission.update({
    where: { id },
    data: { status: input.status as SubmissionStatus },
    select: submissionSelect,
  });
  await recordAudit(actor.id, 'submission.updated', 'submission', id, {
    divisionId: submission.divisionId,
    before: { status: existing.status },
    after: { status: submission.status },
  });
  return present(submission, true);
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function answerText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

export async function exportSubmissions(actor: Actor, filter: SubmissionFilter) {
  assertAnalyticsReader(actor);
  const { where } = await buildSubmissionWhere(actor, filter);
  const rows = await prisma.submission.findMany({
    where,
    orderBy: { submittedAt: 'desc' },
    take: 5000,
    select: submissionSelect,
  });

  const registerTypeId = filter.registerTypeId;
  const exportRows: Array<Record<string, string | number>> = [];
  for (const row of rows) {
    const zone = row.division.zoneId
      ? await prisma.zone.findUnique({
          where: { id: row.division.zoneId },
          select: { name: true },
        })
      : null;
    if (row.answerRows.length) {
      for (const answer of row.answerRows) {
        const registers = answer.question.registers;
        if (
          registerTypeId != null &&
          !registers.some(reg => reg.registerTypeId === registerTypeId)
        ) {
          continue;
        }
        const registerNames =
          registers.length > 0
            ? registers.map(reg => reg.registerType.code).join('|')
            : '';
        if (registerTypeId != null || registers.length <= 1) {
          exportRows.push({
            submissionId: row.id,
            date: row.submittedAt.toISOString(),
            crewName: row.submittedBy.name,
            staffNumber: row.submittedBy.loginId || '',
            crewType: row.crewTypeName || row.crewType?.code || '',
            dutyType: row.dutyTypeName || row.dutyType?.code || '',
            zone: zone?.name || '',
            division: row.division.name,
            lobby: row.lobby?.name || '',
            register: registerTypeId
              ? registers.find(reg => reg.registerTypeId === registerTypeId)?.registerType.code ||
                ''
              : registerNames,
            question: answer.question.text,
            answer: answerText(answer.answer),
            status: row.status,
          });
        } else {
          for (const reg of registers) {
            exportRows.push({
              submissionId: row.id,
              date: row.submittedAt.toISOString(),
              crewName: row.submittedBy.name,
              staffNumber: row.submittedBy.loginId || '',
              crewType: row.crewTypeName || row.crewType?.code || '',
              dutyType: row.dutyTypeName || row.dutyType?.code || '',
              zone: zone?.name || '',
              division: row.division.name,
              lobby: row.lobby?.name || '',
              register: reg.registerType.code,
              question: answer.question.text,
              answer: answerText(answer.answer),
              status: row.status,
            });
          }
        }
      }
    } else {
      const answers =
        row.answers && typeof row.answers === 'object' && !Array.isArray(row.answers)
          ? (row.answers as Record<string, unknown>)
          : {};
      const schema = parseFormSchema(row.formVersion.schema);
      for (const field of schema.fields) {
        exportRows.push({
          submissionId: row.id,
          date: row.submittedAt.toISOString(),
          crewName: row.submittedBy.name,
          staffNumber: row.submittedBy.loginId || '',
          crewType: row.crewTypeName || '',
          dutyType: row.dutyTypeName || '',
          zone: zone?.name || '',
          division: row.division.name,
          lobby: row.lobby?.name || '',
          register: '',
          question: field.label,
          answer: answerText(answers[field.key]),
          status: row.status,
        });
      }
    }
  }

  const header = [
    'Submission ID',
    'Date',
    'Crew Name',
    'Staff Number',
    'Crew Type',
    'Duty Type',
    'Zone',
    'Division',
    'Lobby',
    'Register',
    'Question',
    'Answer',
    'Status',
  ];
  const keys = [
    'submissionId',
    'date',
    'crewName',
    'staffNumber',
    'crewType',
    'dutyType',
    'zone',
    'division',
    'lobby',
    'register',
    'question',
    'answer',
    'status',
  ] as const;

  await recordAudit(actor.id, 'submission.exported', 'submission', null, {
    divisionId: actor.rmoRole === 'SYSTEM_ADMIN' ? filter.divisionId ?? null : actor.homeDivisionId,
    rowCount: exportRows.length,
    formId: filter.formId ?? null,
    registerId: filter.registerId ?? null,
    registerTypeId: filter.registerTypeId ?? null,
    crewTypeId: filter.crewTypeId ?? null,
    dutyTypeId: filter.dutyTypeId ?? null,
    lobbyId: filter.lobbyId ?? null,
    status: filter.status ?? null,
    dateFrom: filter.dateFrom ?? null,
    dateTo: filter.dateTo ?? null,
    format: filter.format ?? 'csv',
  });

  if (filter.format === 'xlsx') {
    const { utils, write } = await import('xlsx');
    const sheet = utils.json_to_sheet(
      exportRows.map(row => {
        const mapped: Record<string, string | number> = {};
        header.forEach((label, index) => {
          mapped[label] = row[keys[index]];
        });
        return mapped;
      }),
    );
    const book = utils.book_new();
    utils.book_append_sheet(book, sheet, 'Submissions');
    const buffer = write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return { kind: 'xlsx' as const, buffer, rowCount: exportRows.length };
  }

  const lines = [header.map(csvCell).join(',')];
  for (const row of exportRows) {
    lines.push(keys.map(key => csvCell(row[key])).join(','));
  }
  return { kind: 'csv' as const, text: lines.join('\n'), rowCount: exportRows.length };
}
