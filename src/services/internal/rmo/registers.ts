import { prisma } from '@/lib/prisma';
import { Prisma, RegisterStatus } from '@/lib/prisma/generated/client';
import { parseFormSchema } from '@/lib/rmo/form-schema';
import { RmoError } from '@/lib/rmo/errors';
import {
  buildWorkbookPreview,
  formatCellDate,
  formatExportFilenameTimestamp,
  sanitizeExportFilenamePart,
  writeWorkbookBuffer,
  type WorkbookColumn,
} from '@/lib/rmo/xlsx';
import type { Actor } from '@/services/internal/rmo/administration';
import { recordAudit } from '@/services/internal/rmo/audit-event';
import {
  assertAnalyticsReader,
  assertFormManager,
  assertRecordReader,
  rejectForeignDivision,
} from '@/services/internal/rmo/submission-scope';

const DENIED = 'You do not have permission to perform this action.';
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;

const registerSelect = {
  id: true,
  name: true,
  description: true,
  divisionId: true,
  formId: true,
  status: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  division: { select: { id: true, name: true, code: true } },
  form: { select: { id: true, name: true, status: true, divisionId: true } },
  createdBy: { select: { id: true, name: true, loginId: true } },
} satisfies Prisma.RegisterSelect;

const fieldSelect = {
  id: true,
  registerId: true,
  fieldKey: true,
  sortOrder: true,
  columnLabel: true,
  isKeyField: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RegisterFieldSelect;

async function formForRegister(actor: Actor, formId: number, divisionId: number) {
  const form = await prisma.form.findUnique({
    where: { id: formId },
    select: { id: true, divisionId: true, name: true },
  });
  if (!form) throw new RmoError('Form was not found.', 400);
  if (form.divisionId !== divisionId) {
    throw new RmoError('A register must use a form from the same division.', 403);
  }
  if (actor.rmoRole !== 'SYSTEM_ADMIN' && form.divisionId !== actor.homeDivisionId) {
    throw new RmoError(DENIED, 403);
  }
  return form;
}

async function loadRegisterInScope(actor: Actor, id: number) {
  assertRecordReader(actor);
  if (!Number.isInteger(id)) throw new RmoError('Register not found.', 404);
  const register = await prisma.register.findUnique({ where: { id }, select: registerSelect });
  if (!register) throw new RmoError('Register not found.', 404);
  if (actor.rmoRole !== 'SYSTEM_ADMIN' && register.divisionId !== actor.homeDivisionId) {
    throw new RmoError(DENIED, 403);
  }
  return register;
}

async function publishedSchemaKeys(formId: number): Promise<Map<string, string>> {
  const form = await prisma.form.findUnique({
    where: { id: formId },
    select: {
      currentVersion: { select: { schema: true, status: true } },
    },
  });
  if (!form?.currentVersion || form.currentVersion.status !== 'PUBLISHED') {
    throw new RmoError('The register form must have a published version.', 400);
  }
  const schema = parseFormSchema(form.currentVersion.schema);
  const map = new Map<string, string>();
  for (const field of schema.fields) {
    map.set(field.key, field.label);
  }
  return map;
}

function answerText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(item => String(item)).join(', ');
  return JSON.stringify(value);
}

function isNonEmptyAnswer(value: unknown): boolean {
  return answerText(value).length > 0;
}

export async function listRegisters(
  actor: Actor,
  query: { search?: string; status?: string; divisionId?: number; page?: number; pageSize?: number },
) {
  const role = assertRecordReader(actor);
  if (query.divisionId != null && !Number.isInteger(query.divisionId)) {
    throw new RmoError('Division is invalid.', 400);
  }
  rejectForeignDivision(actor, query.divisionId);
  const page = Math.max(query.page || 1, 1);
  const pageSize = Math.min(Math.max(query.pageSize || 20, 1), 50);
  const status = query.status === 'ACTIVE' || query.status === 'INACTIVE' ? query.status : undefined;
  const where: Prisma.RegisterWhereInput = {
    ...(status ? { status } : {}),
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    ...(role === 'SYSTEM_ADMIN'
      ? query.divisionId != null
        ? { divisionId: query.divisionId }
        : {}
      : { divisionId: actor.homeDivisionId ?? -1 }),
  };
  const [items, total] = await Promise.all([
    prisma.register.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: registerSelect,
    }),
    prisma.register.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getRegister(actor: Actor, id: number) {
  return loadRegisterInScope(actor, id);
}

export interface RegisterWriteInput {
  name?: string;
  description?: string;
  divisionId?: number;
  formId?: number;
  status?: string;
}

export async function createRegister(actor: Actor, input: RegisterWriteInput) {
  assertFormManager(actor);
  const name = input.name?.trim();
  if (!name) throw new RmoError('Name is required.', 400);
  if (actor.rmoRole === 'DIVISION_ADMIN') {
    if (input.divisionId != null && input.divisionId !== actor.homeDivisionId) {
      throw new RmoError(DENIED, 403);
    }
  }
  const divisionId = actor.rmoRole === 'SYSTEM_ADMIN' ? input.divisionId : actor.homeDivisionId;
  if (divisionId == null || !Number.isInteger(divisionId)) {
    throw new RmoError('A division is required.', 400);
  }
  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    select: { id: true },
  });
  if (!division) throw new RmoError('Division was not found.', 400);
  if (input.formId == null || !Number.isInteger(Number(input.formId))) {
    throw new RmoError('A form is required.', 400);
  }
  await formForRegister(actor, Number(input.formId), divisionId);
  const register = await prisma.register.create({
    data: {
      name,
      description: input.description?.trim() ?? '',
      divisionId,
      formId: Number(input.formId),
      status: 'ACTIVE',
      createdById: actor.id,
    },
    select: registerSelect,
  });
  await recordAudit(actor.id, 'register.created', 'register', register.id, {
    divisionId,
    formId: register.formId,
    name,
  });
  return register;
}

export async function updateRegister(actor: Actor, id: number, input: RegisterWriteInput) {
  assertFormManager(actor);
  const existing = await prisma.register.findUnique({ where: { id }, select: registerSelect });
  if (!existing) throw new RmoError('Register not found.', 404);
  if (actor.rmoRole !== 'SYSTEM_ADMIN' && existing.divisionId !== actor.homeDivisionId) {
    throw new RmoError(DENIED, 403);
  }
  if (input.divisionId != null && input.divisionId !== existing.divisionId) {
    throw new RmoError(DENIED, 403);
  }
  const formId = input.formId == null ? existing.formId : Number(input.formId);
  if (!Number.isInteger(formId)) throw new RmoError('Form is invalid.', 400);
  if (formId !== existing.formId) await formForRegister(actor, formId, existing.divisionId);
  const name = input.name?.trim();
  if (input.name != null && !name) throw new RmoError('Name is required.', 400);
  let status: RegisterStatus | undefined;
  if (input.status != null) {
    if (input.status !== 'ACTIVE' && input.status !== 'INACTIVE') {
      throw new RmoError('Status must be ACTIVE or INACTIVE.', 400);
    }
    status = input.status;
  }
  const register = await prisma.register.update({
    where: { id },
    data: {
      ...(name ? { name } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(formId !== existing.formId ? { formId } : {}),
      ...(status ? { status } : {}),
    },
    select: registerSelect,
  });
  const changed =
    name !== undefined || input.description !== undefined || formId !== existing.formId;
  if (changed) {
    await recordAudit(actor.id, 'register.updated', 'register', id, {
      divisionId: existing.divisionId,
      name: register.name,
      formId: register.formId,
    });
  }
  if (status && status !== existing.status) {
    await recordAudit(
      actor.id,
      status === 'ACTIVE' ? 'register.enabled' : 'register.disabled',
      'register',
      id,
      { divisionId: existing.divisionId },
    );
  }
  return register;
}

export async function listRegisterFields(actor: Actor, registerId: number) {
  const register = await loadRegisterInScope(actor, registerId);
  const schemaKeys = await publishedSchemaKeys(register.formId).catch(() => new Map<string, string>());
  const fields = await prisma.registerField.findMany({
    where: { registerId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: fieldSelect,
  });
  return {
    register: { id: register.id, name: register.name, formId: register.formId },
    availableFields: Array.from(schemaKeys.entries()).map(([key, label]) => ({ key, label })),
    fields: fields.map(field => ({
      ...field,
      label: field.columnLabel || schemaKeys.get(field.fieldKey) || field.fieldKey,
    })),
  };
}

export interface RegisterFieldInput {
  fieldKey: string;
  sortOrder?: number;
  columnLabel?: string | null;
  isKeyField?: boolean;
}

export async function replaceRegisterFields(
  actor: Actor,
  registerId: number,
  input: { fields?: RegisterFieldInput[] },
) {
  assertFormManager(actor);
  const register = await loadRegisterInScope(actor, registerId);
  if (!Array.isArray(input.fields)) {
    throw new RmoError('fields must be an array.', 400);
  }
  const schemaKeys = await publishedSchemaKeys(register.formId);
  const seen = new Set<string>();
  const normalized = input.fields.map((item, index) => {
    const fieldKey = typeof item.fieldKey === 'string' ? item.fieldKey.trim() : '';
    if (!KEY_PATTERN.test(fieldKey)) {
      throw new RmoError(`Field key is invalid: ${fieldKey || '(empty)'}.`, 400);
    }
    if (!schemaKeys.has(fieldKey)) {
      throw new RmoError(`Field key is not on the published form: ${fieldKey}.`, 400);
    }
    if (seen.has(fieldKey)) {
      throw new RmoError(`Duplicate field key: ${fieldKey}.`, 400);
    }
    seen.add(fieldKey);
    const columnLabel =
      item.columnLabel == null || item.columnLabel === ''
        ? null
        : String(item.columnLabel).trim().slice(0, 200);
    return {
      registerId,
      fieldKey,
      sortOrder: Number.isInteger(item.sortOrder) ? Number(item.sortOrder) : index,
      columnLabel,
      isKeyField: Boolean(item.isKeyField),
    };
  });

  await prisma.$transaction(async tx => {
    await tx.registerField.deleteMany({ where: { registerId } });
    if (normalized.length > 0) {
      await tx.registerField.createMany({ data: normalized });
    }
  });

  await recordAudit(actor.id, 'register.fields_updated', 'register', registerId, {
    divisionId: register.divisionId,
    fieldCount: normalized.length,
    keyFields: normalized.filter(field => field.isKeyField).map(field => field.fieldKey),
  });

  return listRegisterFields(actor, registerId);
}

export interface RegisterEntriesFilter {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

function parseDateBound(value: string | undefined, end: boolean): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RmoError('Date is invalid.', 400);
  return new Date(end ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`);
}

function entryPassesVisibility(
  answers: Record<string, unknown>,
  fields: Array<{ fieldKey: string; isKeyField: boolean }>,
): boolean {
  if (fields.length === 0) return false;
  const keyFields = fields.filter(field => field.isKeyField);
  if (keyFields.length > 0) {
    return keyFields.every(field => isNonEmptyAnswer(answers[field.fieldKey]));
  }
  return fields.some(field => isNonEmptyAnswer(answers[field.fieldKey]));
}

export async function listRegisterEntries(
  actor: Actor,
  registerId: number,
  filter: RegisterEntriesFilter,
) {
  const register = await loadRegisterInScope(actor, registerId);
  const fields = await prisma.registerField.findMany({
    where: { registerId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: fieldSelect,
  });
  const schemaKeys = await publishedSchemaKeys(register.formId).catch(() => new Map<string, string>());
  const columns = fields.map(field => ({
    key: field.fieldKey,
    header: field.columnLabel || schemaKeys.get(field.fieldKey) || field.fieldKey,
    fieldKey: field.fieldKey,
    isKeyField: field.isKeyField,
    sortOrder: field.sortOrder,
  }));

  if (fields.length === 0) {
    return {
      register: {
        id: register.id,
        name: register.name,
        description: register.description,
        status: register.status,
        formId: register.formId,
      },
      columns,
      entries: [],
      total: 0,
      page: 1,
      pageSize: Math.min(Math.max(filter.pageSize || 20, 1), 50),
      filters: {
        search: filter.search ?? null,
        dateFrom: filter.dateFrom ?? null,
        dateTo: filter.dateTo ?? null,
      },
    };
  }

  const page = Math.max(filter.page || 1, 1);
  const pageSize = Math.min(Math.max(filter.pageSize || 20, 1), 50);
  const dateFrom = parseDateBound(filter.dateFrom, false);
  const dateTo = parseDateBound(filter.dateTo, true);
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new RmoError('dateFrom cannot be after dateTo.', 400);
  }

  const where: Prisma.SubmissionWhereInput = {
    formId: register.formId,
    divisionId: register.divisionId,
    ...(dateFrom || dateTo
      ? {
          submittedAt: {
            ...(dateFrom ? { gte: dateFrom } : {}),
            ...(dateTo ? { lte: dateTo } : {}),
          },
        }
      : {}),
    ...(filter.search
      ? {
          OR: [
            { submittedBy: { name: { contains: filter.search, mode: 'insensitive' } } },
            { submittedBy: { loginId: { contains: filter.search, mode: 'insensitive' } } },
            { submittedBy: { email: { contains: filter.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const candidates = await prisma.submission.findMany({
    where,
    orderBy: { submittedAt: 'desc' },
    take: 5000,
    select: {
      id: true,
      submittedAt: true,
      status: true,
      answers: true,
      lobby: { select: { id: true, name: true, code: true } },
      submittedBy: { select: { id: true, name: true, loginId: true, email: true } },
    },
  });

  const visible = candidates.filter(row => {
    const answers =
      row.answers && typeof row.answers === 'object' && !Array.isArray(row.answers)
        ? (row.answers as Record<string, unknown>)
        : {};
    return entryPassesVisibility(answers, fields);
  });

  const total = visible.length;
  const pageRows = visible.slice((page - 1) * pageSize, page * pageSize);
  const entries = pageRows.map(row => {
    const answers =
      row.answers && typeof row.answers === 'object' && !Array.isArray(row.answers)
        ? (row.answers as Record<string, unknown>)
        : {};
    const values: Record<string, string> = {};
    for (const field of fields) {
      values[field.fieldKey] = answerText(answers[field.fieldKey]);
    }
    return {
      submissionId: row.id,
      submittedAt: row.submittedAt,
      status: row.status,
      lobby: row.lobby,
      submittedBy: row.submittedBy,
      values,
    };
  });

  return {
    register: {
      id: register.id,
      name: register.name,
      description: register.description,
      status: register.status,
      formId: register.formId,
    },
    columns,
    entries,
    total,
    page,
    pageSize,
    filters: {
      search: filter.search ?? null,
      dateFrom: filter.dateFrom ?? null,
      dateTo: filter.dateTo ?? null,
    },
  };
}

function buildRegisterFilename(
  registerName: string,
  dateFrom: string | null,
  dateTo: string | null,
  exportedAt: Date,
) {
  const safeName = sanitizeExportFilenamePart(registerName);
  let range = 'all';
  if (dateFrom && dateTo) range = `${dateFrom}_to_${dateTo}`;
  else if (dateFrom) range = `from_${dateFrom}`;
  else if (dateTo) range = `to_${dateTo}`;
  return `${safeName}-${sanitizeExportFilenamePart(range)}-${formatExportFilenameTimestamp(exportedAt)}.xlsx`;
}

async function buildRegisterExportData(
  actor: Actor,
  registerId: number,
  filter: RegisterEntriesFilter,
) {
  assertAnalyticsReader(actor);
  const pageData = await listRegisterEntries(actor, registerId, {
    ...filter,
    page: 1,
    pageSize: 5000,
  });
  const exportedAt = new Date();
  const fixedColumns: WorkbookColumn[] = [
    { key: 'login_id', header: 'Login ID', width: 18 },
    { key: 'name', header: 'Name', width: 24 },
    { key: 'lobby', header: 'Lobby', width: 18 },
    { key: 'submitted_at', header: 'Submitted At', width: 20 },
    { key: 'status', header: 'Status', width: 12 },
  ];
  const mappedColumns: WorkbookColumn[] = pageData.columns.map(column => ({
    key: `f_${column.fieldKey}`,
    header: column.header,
    width: Math.max(18, Math.min(48, column.header.length + 6)),
  }));
  const columns = [...fixedColumns, ...mappedColumns];
  const rows = pageData.entries.map(entry => {
    const row: Record<string, unknown> = {
      login_id: entry.submittedBy.loginId || '',
      name: entry.submittedBy.name || '',
      lobby: entry.lobby?.name || '',
      submitted_at: formatCellDate(entry.submittedAt),
      status: entry.status,
    };
    for (const column of pageData.columns) {
      row[`f_${column.fieldKey}`] = entry.values[column.fieldKey] || '';
    }
    return row;
  });

  return {
    register: pageData.register,
    exportedAt,
    filename: buildRegisterFilename(
      pageData.register.name,
      pageData.filters.dateFrom,
      pageData.filters.dateTo,
      exportedAt,
    ),
    filters: pageData.filters,
    columns,
    rows,
  };
}

export async function previewRegisterExport(
  actor: Actor,
  registerId: number,
  filter: RegisterEntriesFilter,
) {
  const data = await buildRegisterExportData(actor, registerId, filter);
  return buildWorkbookPreview({
    title: `${data.register.name} export`,
    filename: data.filename,
    exportedAt: data.exportedAt,
    filters: {
      search: data.filters.search,
      dateFrom: data.filters.dateFrom,
      dateTo: data.filters.dateTo,
    },
    sheets: [
      {
        key: 'register_entries',
        name: data.register.name,
        columns: data.columns,
        rows: data.rows,
      },
    ],
  });
}

export async function exportRegisterXlsx(
  actor: Actor,
  registerId: number,
  filter: RegisterEntriesFilter,
) {
  const data = await buildRegisterExportData(actor, registerId, filter);
  const buffer = await writeWorkbookBuffer({
    title: `${data.register.name} export`,
    creator: 'RMO Registers',
    exportedAt: data.exportedAt,
    infoRows: [
      { field: 'register_id', value: data.register.id },
      { field: 'register_name', value: data.register.name },
      { field: 'export_generated_at', value: formatCellDate(data.exportedAt) },
      { field: 'filter_from_date', value: data.filters.dateFrom || '' },
      { field: 'filter_to_date', value: data.filters.dateTo || '' },
      { field: 'filter_search', value: data.filters.search || '' },
      { field: 'row_count', value: data.rows.length },
    ],
    sheets: [
      {
        key: 'register_entries',
        name: data.register.name,
        columns: data.columns,
        rows: data.rows,
      },
    ],
  });
  const registerMeta = await prisma.register.findUnique({
    where: { id: registerId },
    select: { divisionId: true },
  });
  await recordAudit(actor.id, 'register.exported', 'register', registerId, {
    divisionId: registerMeta?.divisionId ?? null,
    rowCount: data.rows.length,
    dateFrom: data.filters.dateFrom,
    dateTo: data.filters.dateTo,
    search: data.filters.search,
  });
  return { buffer, filename: data.filename };
}
