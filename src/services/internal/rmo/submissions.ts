import { prisma } from '@/lib/prisma';
import { Prisma, SubmissionStatus } from '@/lib/prisma/generated/client';
import { FormSchemaError, parseFormSchema, validateAnswers } from '@/lib/rmo/form-schema';
import { RmoError } from '@/lib/rmo/errors';
import {
  buildWorkbookPreview,
  formatCellDate,
  formatExportFilenameTimestamp,
  sanitizeExportFilenamePart,
  writeWorkbookBuffer,
  type WorkbookColumn,
  type WorkbookSheetData,
} from '@/lib/rmo/xlsx';
import type { Actor } from '@/services/internal/rmo/administration';
import { recordAudit } from '@/services/internal/rmo/audit-event';
import {
  actorRole,
  assertAnalyticsReader,
  assertSubmitter,
  assignedFormIds,
  buildSubmissionWhere,
  type SubmissionFilter,
} from '@/services/internal/rmo/submission-scope';

const DENIED = 'You do not have permission to perform this action.';

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
  form: { select: { id: true, name: true, description: true } },
  formVersion: { select: { id: true, versionNumber: true, status: true, schema: true } },
  division: { select: { id: true, name: true, code: true } },
  lobby: { select: { id: true, name: true, code: true } },
  submittedBy: { select: { id: true, name: true, loginId: true } },
} satisfies Prisma.SubmissionSelect;

function present(
  row: Prisma.SubmissionGetPayload<{ select: typeof submissionSelect }>,
  includeSchema: boolean,
) {
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
    form: row.form,
    division: row.division,
    lobby: row.lobby,
    submittedBy: row.submittedBy,
    formVersion: {
      id: row.formVersion.id,
      versionNumber: row.formVersion.versionNumber,
      status: row.formVersion.status,
      ...(includeSchema ? { schema: parseFormSchema(row.formVersion.schema) } : {}),
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

export async function getSubmission(actor: Actor, id: number) {
  if (!Number.isInteger(id)) throw new RmoError('Submission not found.', 404);
  return present(await loadInScope(actor, id), true);
}

export async function createSubmission(
  actor: Actor,
  input: {
    formId?: number;
    answers?: unknown;
    divisionId?: number;
    lobbyId?: number;
  },
) {
  assertSubmitter(actor);
  if (input.divisionId != null && input.divisionId !== actor.homeDivisionId) {
    throw new RmoError(DENIED, 403);
  }
  if (input.lobbyId != null && input.lobbyId !== actor.homeLobbyId) {
    throw new RmoError(DENIED, 403);
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
  const text =
    value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
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
  const fieldKeys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const schema = parseFormSchema(row.formVersion.schema);
    for (const field of schema.fields) {
      if (seen.has(field.key)) continue;
      seen.add(field.key);
      fieldKeys.push(field.key);
    }
  }
  const header = [
    'id',
    'form',
    'formVersion',
    'division',
    'lobby',
    'submittedBy',
    'submittedAt',
    'status',
    ...fieldKeys,
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) {
    const answers =
      row.answers && typeof row.answers === 'object' && !Array.isArray(row.answers)
        ? (row.answers as Record<string, unknown>)
        : {};
    lines.push(
      [
        row.id,
        row.form.name,
        row.formVersion.versionNumber,
        row.division.name,
        row.lobby?.name ?? '',
        row.submittedBy.loginId || row.submittedBy.name,
        row.submittedAt.toISOString(),
        row.status,
        ...fieldKeys.map(key => answers[key] ?? ''),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  await recordAudit(actor.id, 'submission.exported', 'submission', null, {
    divisionId: actor.rmoRole === 'SYSTEM_ADMIN' ? filter.divisionId ?? null : actor.homeDivisionId,
    rowCount: rows.length,
    formId: filter.formId ?? null,
    registerId: filter.registerId ?? null,
    lobbyId: filter.lobbyId ?? null,
    status: filter.status ?? null,
    dateFrom: filter.dateFrom ?? null,
    dateTo: filter.dateTo ?? null,
    format: 'csv',
  });
  return lines.join('\n');
}

function answerDisplay(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(item => String(item)).join(', ');
  return JSON.stringify(value);
}

function buildSubmissionsFilename(filter: SubmissionFilter, exportedAt: Date) {
  let range = 'all';
  if (filter.dateFrom && filter.dateTo) range = `${filter.dateFrom}_to_${filter.dateTo}`;
  else if (filter.dateFrom) range = `from_${filter.dateFrom}`;
  else if (filter.dateTo) range = `to_${filter.dateTo}`;
  return `form-submissions-${sanitizeExportFilenamePart(range)}-${formatExportFilenameTimestamp(exportedAt)}.xlsx`;
}

async function loadExportRows(actor: Actor, filter: SubmissionFilter) {
  assertAnalyticsReader(actor);
  const { where } = await buildSubmissionWhere(actor, filter);
  return prisma.submission.findMany({
    where,
    orderBy: { submittedAt: 'desc' },
    take: 5000,
    select: submissionSelect,
  });
}

function buildFormSheets(
  rows: Prisma.SubmissionGetPayload<{ select: typeof submissionSelect }>[],
): WorkbookSheetData[] {
  const byForm = new Map<number, typeof rows>();
  for (const row of rows) {
    const bucket = byForm.get(row.formId) ?? [];
    bucket.push(row);
    byForm.set(row.formId, bucket);
  }

  const sheets: WorkbookSheetData[] = [];
  for (const [, formRows] of byForm) {
    const formName = formRows[0]?.form.name || 'Form';
    const fieldMeta = new Map<string, string>();
    for (const row of formRows) {
      const schema = parseFormSchema(row.formVersion.schema);
      for (const field of schema.fields) {
        if (!fieldMeta.has(field.key)) fieldMeta.set(field.key, field.label || field.key);
      }
    }
    const fixed: WorkbookColumn[] = [
      { key: 'submission_id', header: 'Submission ID', width: 14 },
      { key: 'form_version', header: 'Form Version', width: 12 },
      { key: 'division', header: 'Division', width: 18 },
      { key: 'lobby', header: 'Lobby', width: 18 },
      { key: 'submitted_by', header: 'Submitted By', width: 20 },
      { key: 'submitted_at', header: 'Submitted At', width: 20 },
      { key: 'status', header: 'Status', width: 12 },
    ];
    const dynamic: WorkbookColumn[] = Array.from(fieldMeta.entries()).map(([key, label]) => ({
      key: `f_${key}`,
      header: label,
      width: Math.max(18, Math.min(48, label.length + 6)),
    }));
    const sheetRows = formRows.map(row => {
      const answers =
        row.answers && typeof row.answers === 'object' && !Array.isArray(row.answers)
          ? (row.answers as Record<string, unknown>)
          : {};
      const out: Record<string, unknown> = {
        submission_id: row.id,
        form_version: row.formVersion.versionNumber,
        division: row.division.name,
        lobby: row.lobby?.name ?? '',
        submitted_by: row.submittedBy.loginId || row.submittedBy.name,
        submitted_at: formatCellDate(row.submittedAt),
        status: row.status,
      };
      for (const key of fieldMeta.keys()) {
        out[`f_${key}`] = answerDisplay(answers[key]);
      }
      return out;
    });
    sheets.push({
      key: `form_${formRows[0].formId}`,
      name: formName,
      columns: [...fixed, ...dynamic],
      rows: sheetRows,
    });
  }
  return sheets;
}

async function buildSubmissionsWorkbook(actor: Actor, filter: SubmissionFilter) {
  const rows = await loadExportRows(actor, filter);
  const exportedAt = new Date();
  const filename = buildSubmissionsFilename(filter, exportedAt);
  const sheets = buildFormSheets(rows);
  const filters = {
    search: filter.search ?? null,
    status: filter.status ?? null,
    divisionId: filter.divisionId != null ? String(filter.divisionId) : null,
    lobbyId: filter.lobbyId != null ? String(filter.lobbyId) : null,
    formId: filter.formId != null ? String(filter.formId) : null,
    registerId: filter.registerId != null ? String(filter.registerId) : null,
    dateFrom: filter.dateFrom ?? null,
    dateTo: filter.dateTo ?? null,
  };
  return { rows, exportedAt, filename, sheets, filters };
}

export async function previewSubmissionsExport(actor: Actor, filter: SubmissionFilter) {
  const data = await buildSubmissionsWorkbook(actor, filter);
  return buildWorkbookPreview({
    title: 'Form submissions analytics export',
    filename: data.filename,
    exportedAt: data.exportedAt,
    filters: data.filters,
    sheets: data.sheets,
  });
}

export async function exportSubmissionsXlsx(actor: Actor, filter: SubmissionFilter) {
  const data = await buildSubmissionsWorkbook(actor, filter);
  const buffer = await writeWorkbookBuffer({
    title: 'Form submissions analytics export',
    creator: 'RMO Forms analytics',
    exportedAt: data.exportedAt,
    infoRows: [
      { field: 'export_generated_at', value: formatCellDate(data.exportedAt) },
      { field: 'workbook_title', value: 'Form submissions analytics export' },
      { field: 'filter_from_date', value: data.filters.dateFrom || '' },
      { field: 'filter_to_date', value: data.filters.dateTo || '' },
      { field: 'filter_search', value: data.filters.search || '' },
      { field: 'filter_status', value: data.filters.status || '' },
      { field: 'filter_form_id', value: data.filters.formId || '' },
      { field: 'filter_register_id', value: data.filters.registerId || '' },
      { field: 'row_count', value: data.rows.length },
    ],
    sheets: data.sheets,
  });
  await recordAudit(actor.id, 'submission.exported', 'submission', null, {
    divisionId: actor.rmoRole === 'SYSTEM_ADMIN' ? filter.divisionId ?? null : actor.homeDivisionId,
    rowCount: data.rows.length,
    formId: filter.formId ?? null,
    registerId: filter.registerId ?? null,
    lobbyId: filter.lobbyId ?? null,
    status: filter.status ?? null,
    dateFrom: filter.dateFrom ?? null,
    dateTo: filter.dateTo ?? null,
    format: 'xlsx',
  });
  return { buffer, filename: data.filename };
}
