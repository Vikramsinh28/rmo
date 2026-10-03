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
import type { FieldType, FormField } from '@/types/form';

const DENIED = 'You do not have permission to perform this action.';

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
  _count: { select: { fields: true } },
} satisfies Prisma.RegisterSelect;

const fieldSelect = {
  id: true,
  registerId: true,
  formId: true,
  formVersionId: true,
  fieldId: true,
  fieldKey: true,
  crewTypeId: true,
  dutyTypeId: true,
  sortOrder: true,
  columnLabel: true,
  isKeyField: true,
  createdAt: true,
  updatedAt: true,
  form: { select: { id: true, name: true } },
  formVersion: { select: { id: true, versionNumber: true, status: true } },
  crewType: { select: { id: true, code: true, name: true } },
  dutyType: { select: { id: true, code: true, name: true } },
} satisfies Prisma.RegisterFieldSelect;

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

async function publishedSchemaKeys(formId: number | null): Promise<Map<string, string>> {
  if (formId == null) return new Map();
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

/** Prefer stable fieldKey when unique; fall back to mapping id for collisions. */
function resolveValueKeys(mappings: Array<{ id: number; fieldKey: string }>) {
  const counts = new Map<string, number>();
  for (const mapping of mappings) {
    counts.set(mapping.fieldKey, (counts.get(mapping.fieldKey) || 0) + 1);
  }
  const keys = new Map<number, string>();
  for (const mapping of mappings) {
    keys.set(
      mapping.id,
      (counts.get(mapping.fieldKey) || 0) > 1 ? `m_${mapping.id}` : mapping.fieldKey,
    );
  }
  return keys;
}

function exportColumnKey(valueKey: string, fieldKey: string) {
  return valueKey === fieldKey ? `f_${fieldKey}` : valueKey;
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

function presentRegister(row: Prisma.RegisterGetPayload<{ select: typeof registerSelect }>) {
  return {
    ...row,
    questionCount: row._count.fields,
  };
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
  return { items: items.map(presentRegister), total, page, pageSize };
}

export async function getRegister(actor: Actor, id: number) {
  return presentRegister(await loadRegisterInScope(actor, id));
}

export interface RegisterWriteInput {
  name?: string;
  description?: string;
  divisionId?: number;
  formId?: number | null;
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

  let formId: number | null = null;
  if (input.formId != null) {
    const id = Number(input.formId);
    if (!Number.isInteger(id)) throw new RmoError('Form is invalid.', 400);
    const form = await prisma.form.findUnique({
      where: { id },
      select: { id: true, divisionId: true },
    });
    if (!form || form.divisionId !== divisionId) {
      throw new RmoError('A register must use a form from the same division.', 400);
    }
    formId = form.id;
  }

  const duplicate = await prisma.register.findFirst({
    where: { divisionId, name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  });
  if (duplicate) throw new RmoError('A register with this name already exists in the division.', 409);

  try {
    const register = await prisma.register.create({
      data: {
        name,
        description: input.description?.trim() ?? '',
        status: 'ACTIVE',
        division: { connect: { id: divisionId } },
        createdBy: { connect: { id: actor.id } },
        ...(formId != null ? { form: { connect: { id: formId } } } : {}),
      },
      select: registerSelect,
    });
    await recordAudit(actor.id, 'register.created', 'register', register.id, {
      divisionId,
      formId: register.formId,
      name,
    });
    return presentRegister(register);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new RmoError('A register with this name already exists in the division.', 409);
    }
    throw error;
  }
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

  let formId = existing.formId;
  if (input.formId !== undefined) {
    if (input.formId == null || input.formId === ('' as unknown as number)) {
      formId = null;
    } else {
      const next = Number(input.formId);
      if (!Number.isInteger(next)) throw new RmoError('Form is invalid.', 400);
      const form = await prisma.form.findUnique({
        where: { id: next },
        select: { id: true, divisionId: true },
      });
      if (!form || form.divisionId !== existing.divisionId) {
        throw new RmoError('A register must use a form from the same division.', 400);
      }
      formId = form.id;
    }
  }

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
      ...(input.formId !== undefined ? { formId } : {}),
      ...(status ? { status } : {}),
    },
    select: registerSelect,
  });
  const changed =
    name !== undefined || input.description !== undefined || input.formId !== undefined;
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
  return presentRegister(register);
}

function presentMapping(
  field: Prisma.RegisterFieldGetPayload<{ select: typeof fieldSelect }>,
) {
  return {
    id: field.id,
    registerId: field.registerId,
    formId: field.formId,
    formVersionId: field.formVersionId,
    fieldId: field.fieldId,
    fieldKey: field.fieldKey,
    crewTypeId: field.crewTypeId,
    dutyTypeId: field.dutyTypeId,
    sortOrder: field.sortOrder,
    columnLabel: field.columnLabel,
    isKeyField: field.isKeyField,
    label: field.columnLabel || field.fieldKey,
    form: field.form,
    formVersion: field.formVersion,
    crewType: field.crewType,
    dutyType: field.dutyType,
    sourceLabel: [
      field.crewType?.code,
      field.dutyType?.code,
      field.form.name,
      `v${field.formVersion.versionNumber}`,
    ]
      .filter(Boolean)
      .join(' / '),
  };
}

export async function listRegisterFields(actor: Actor, registerId: number) {
  const register = await loadRegisterInScope(actor, registerId);
  const schemaKeys = await publishedSchemaKeys(register.formId).catch(
    () => new Map<string, string>(),
  );
  const fields = await prisma.registerField.findMany({
    where: { registerId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: fieldSelect,
  });
  return {
    register: {
      id: register.id,
      name: register.name,
      formId: register.formId,
      divisionId: register.divisionId,
    },
    availableFields: Array.from(schemaKeys.entries()).map(([key, label]) => ({ key, label })),
    fields: fields.map(presentMapping),
  };
}

export interface RegisterMappingInput {
  formId: number;
  formVersionId: number;
  fieldId: string;
  fieldKey?: string;
  crewTypeId?: number | null;
  dutyTypeId?: number | null;
  columnLabel?: string | null;
  isKeyField?: boolean;
  sortOrder?: number;
}

async function resolvePublishedField(input: {
  divisionId: number;
  formId: number;
  formVersionId: number;
  fieldId: string;
}) {
  const version = await prisma.formVersion.findUnique({
    where: { id: input.formVersionId },
    select: {
      id: true,
      formId: true,
      versionNumber: true,
      status: true,
      schema: true,
      form: {
        select: {
          id: true,
          name: true,
          divisionId: true,
          status: true,
          crewTypeId: true,
          dutyTypeId: true,
        },
      },
    },
  });
  if (!version || version.formId !== input.formId) {
    throw new RmoError('Form version was not found.', 400);
  }
  if (version.form.divisionId !== input.divisionId) {
    throw new RmoError('Question must belong to the register division.', 403);
  }
  if (version.status !== 'PUBLISHED' && version.form.status !== 'PUBLISHED') {
    // Allow published versions even if form later archived? Prefer published version.
  }
  if (version.status !== 'PUBLISHED') {
    throw new RmoError('Only published form versions can be mapped.', 400);
  }
  const schema = parseFormSchema(version.schema);
  const field = schema.fields.find(item => item.id === input.fieldId || item.key === input.fieldId);
  if (!field) throw new RmoError('Question was not found on the form version.', 400);
  return { version, field, form: version.form };
}

export async function addRegisterQuestion(
  actor: Actor,
  registerId: number,
  input: RegisterMappingInput,
) {
  assertFormManager(actor);
  const register = await loadRegisterInScope(actor, registerId);
  if (!Number.isInteger(input.formId) || !Number.isInteger(input.formVersionId)) {
    throw new RmoError('Form and form version are required.', 400);
  }
  if (!input.fieldId?.trim()) throw new RmoError('Question is required.', 400);

  const resolved = await resolvePublishedField({
    divisionId: register.divisionId,
    formId: input.formId,
    formVersionId: input.formVersionId,
    fieldId: input.fieldId.trim(),
  });

  const existing = await prisma.registerField.findUnique({
    where: {
      registerId_formVersionId_fieldId: {
        registerId,
        formVersionId: resolved.version.id,
        fieldId: resolved.field.id,
      },
    },
    select: { id: true },
  });
  if (existing) throw new RmoError('This question is already mapped to the register.', 409);

  const maxOrder = await prisma.registerField.aggregate({
    where: { registerId },
    _max: { sortOrder: true },
  });
  const created = await prisma.registerField.create({
    data: {
      registerId,
      formId: resolved.form.id,
      formVersionId: resolved.version.id,
      fieldId: resolved.field.id,
      fieldKey: resolved.field.key,
      crewTypeId: input.crewTypeId ?? resolved.form.crewTypeId,
      dutyTypeId: input.dutyTypeId ?? resolved.form.dutyTypeId,
      columnLabel:
        input.columnLabel == null || input.columnLabel === ''
          ? resolved.field.label
          : String(input.columnLabel).trim().slice(0, 200),
      isKeyField: Boolean(input.isKeyField),
      sortOrder:
        Number.isInteger(input.sortOrder) && input.sortOrder != null
          ? Number(input.sortOrder)
          : (maxOrder._max.sortOrder ?? -1) + 1,
    },
    select: fieldSelect,
  });
  await recordAudit(actor.id, 'register.question.added', 'register_field', created.id, {
    registerId,
    divisionId: register.divisionId,
    formId: created.formId,
    formVersionId: created.formVersionId,
    fieldId: created.fieldId,
  });
  return listRegisterFields(actor, registerId);
}

export async function updateRegisterQuestion(
  actor: Actor,
  registerId: number,
  mappingId: number,
  input: {
    columnLabel?: string | null;
    isKeyField?: boolean;
    sortOrder?: number;
  },
) {
  assertFormManager(actor);
  const register = await loadRegisterInScope(actor, registerId);
  if (!Number.isInteger(mappingId)) throw new RmoError('Mapping not found.', 404);
  const existing = await prisma.registerField.findFirst({
    where: { id: mappingId, registerId },
    select: { id: true },
  });
  if (!existing) throw new RmoError('Mapping not found.', 404);
  const updated = await prisma.registerField.update({
    where: { id: mappingId },
    data: {
      ...(input.columnLabel !== undefined
        ? {
            columnLabel:
              input.columnLabel == null || input.columnLabel === ''
                ? null
                : String(input.columnLabel).trim().slice(0, 200),
          }
        : {}),
      ...(input.isKeyField !== undefined ? { isKeyField: Boolean(input.isKeyField) } : {}),
      ...(input.sortOrder !== undefined && Number.isInteger(input.sortOrder)
        ? { sortOrder: Number(input.sortOrder) }
        : {}),
    },
    select: fieldSelect,
  });
  await recordAudit(actor.id, 'register.question.updated', 'register_field', mappingId, {
    registerId,
    divisionId: register.divisionId,
    formId: updated.formId,
    formVersionId: updated.formVersionId,
    fieldId: updated.fieldId,
  });
  return listRegisterFields(actor, registerId);
}

export async function removeRegisterQuestion(actor: Actor, registerId: number, mappingId: number) {
  assertFormManager(actor);
  const register = await loadRegisterInScope(actor, registerId);
  if (!Number.isInteger(mappingId)) throw new RmoError('Mapping not found.', 404);
  const existing = await prisma.registerField.findFirst({
    where: { id: mappingId, registerId },
    select: fieldSelect,
  });
  if (!existing) throw new RmoError('Mapping not found.', 404);
  await prisma.registerField.delete({ where: { id: mappingId } });
  await recordAudit(actor.id, 'register.question.removed', 'register_field', mappingId, {
    registerId,
    divisionId: register.divisionId,
    formId: existing.formId,
    formVersionId: existing.formVersionId,
    fieldId: existing.fieldId,
  });
  return listRegisterFields(actor, registerId);
}

export async function reorderRegisterQuestions(
  actor: Actor,
  registerId: number,
  orderedIds: number[],
) {
  assertFormManager(actor);
  const register = await loadRegisterInScope(actor, registerId);
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw new RmoError('orderedIds must be a non-empty array.', 400);
  }
  const existing = await prisma.registerField.findMany({
    where: { registerId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map(row => row.id));
  if (orderedIds.length !== existingIds.size || orderedIds.some(id => !existingIds.has(id))) {
    throw new RmoError('orderedIds must include every mapped question exactly once.', 400);
  }
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.registerField.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );
  await recordAudit(actor.id, 'register.question.updated', 'register', registerId, {
    divisionId: register.divisionId,
    action: 'reorder',
    count: orderedIds.length,
  });
  return listRegisterFields(actor, registerId);
}

/** Legacy bulk replace — maps fieldKeys onto the register's primary/current form version. */
export interface RegisterFieldInput {
  fieldKey: string;
  sortOrder?: number;
  columnLabel?: string | null;
  isKeyField?: boolean;
  formId?: number;
  formVersionId?: number;
  fieldId?: string;
  crewTypeId?: number | null;
  dutyTypeId?: number | null;
}

export async function replaceRegisterFields(
  actor: Actor,
  registerId: number,
  input: { fields?: RegisterFieldInput[] },
) {
  assertFormManager(actor);
  const register = await loadRegisterInScope(actor, registerId);
  if (!Array.isArray(input.fields)) throw new RmoError('fields must be an array.', 400);

  const normalized: Array<{
    registerId: number;
    formId: number;
    formVersionId: number;
    fieldId: string;
    fieldKey: string;
    crewTypeId: number | null;
    dutyTypeId: number | null;
    sortOrder: number;
    columnLabel: string | null;
    isKeyField: boolean;
  }> = [];
  for (let index = 0; index < input.fields.length; index += 1) {
    const item = input.fields[index];
    if (item.formId && item.formVersionId && (item.fieldId || item.fieldKey)) {
      const resolved = await resolvePublishedField({
        divisionId: register.divisionId,
        formId: Number(item.formId),
        formVersionId: Number(item.formVersionId),
        fieldId: String(item.fieldId || item.fieldKey),
      });
      normalized.push({
        registerId,
        formId: resolved.form.id,
        formVersionId: resolved.version.id,
        fieldId: resolved.field.id,
        fieldKey: resolved.field.key,
        crewTypeId: item.crewTypeId ?? resolved.form.crewTypeId,
        dutyTypeId: item.dutyTypeId ?? resolved.form.dutyTypeId,
        sortOrder: Number.isInteger(item.sortOrder) ? Number(item.sortOrder) : index,
        columnLabel:
          item.columnLabel == null || item.columnLabel === ''
            ? resolved.field.label
            : String(item.columnLabel).trim().slice(0, 200),
        isKeyField: Boolean(item.isKeyField),
      });
      continue;
    }
    if (!register.formId) {
      throw new RmoError('formId and formVersionId are required for each mapping.', 400);
    }
    const form = await prisma.form.findUnique({
      where: { id: register.formId },
      select: {
        id: true,
        currentVersionId: true,
        crewTypeId: true,
        dutyTypeId: true,
        currentVersion: { select: { id: true, status: true, schema: true } },
      },
    });
    if (!form?.currentVersion || form.currentVersion.status !== 'PUBLISHED') {
      throw new RmoError('The register form must have a published version.', 400);
    }
    const schema = parseFormSchema(form.currentVersion.schema);
    const field = schema.fields.find(row => row.key === item.fieldKey);
    if (!field) throw new RmoError(`Field key is not on the published form: ${item.fieldKey}.`, 400);
    normalized.push({
      registerId,
      formId: form.id,
      formVersionId: form.currentVersion.id,
      fieldId: field.id,
      fieldKey: field.key,
      crewTypeId: form.crewTypeId,
      dutyTypeId: form.dutyTypeId,
      sortOrder: Number.isInteger(item.sortOrder) ? Number(item.sortOrder) : index,
      columnLabel:
        item.columnLabel == null || item.columnLabel === ''
          ? null
          : String(item.columnLabel).trim().slice(0, 200),
      isKeyField: Boolean(item.isKeyField),
    });
  }

  const seen = new Set<string>();
  for (const row of normalized) {
    const key = `${row.formVersionId}:${row.fieldId}`;
    if (seen.has(key)) throw new RmoError('Duplicate question mapping.', 400);
    seen.add(key);
  }

  await prisma.$transaction(async tx => {
    await tx.registerField.deleteMany({ where: { registerId } });
    if (normalized.length > 0) await tx.registerField.createMany({ data: normalized });
  });

  await recordAudit(actor.id, 'register.fields_updated', 'register', registerId, {
    divisionId: register.divisionId,
    fieldCount: normalized.length,
  });
  return listRegisterFields(actor, registerId);
}

export async function listRegisterQuestionOptions(
  actor: Actor,
  query: {
    divisionId?: number;
    crewTypeId?: number;
    dutyTypeId?: number;
    formId?: number;
    formVersionId?: number;
  },
) {
  assertFormManager(actor);
  rejectForeignDivision(actor, query.divisionId);
  const divisionId =
    actor.rmoRole === 'SYSTEM_ADMIN' ? query.divisionId ?? null : actor.homeDivisionId;
  if (divisionId == null) throw new RmoError('A division is required.', 400);

  const forms = await prisma.form.findMany({
    where: {
      divisionId,
      status: 'PUBLISHED',
      purpose: 'GENERAL',
      ...(query.crewTypeId != null ? { crewTypeId: query.crewTypeId } : {}),
      ...(query.dutyTypeId != null ? { dutyTypeId: query.dutyTypeId } : {}),
      ...(query.formId != null ? { id: query.formId } : {}),
      currentVersion: { status: 'PUBLISHED' },
    },
    select: {
      id: true,
      name: true,
      crewTypeId: true,
      dutyTypeId: true,
      crewType: { select: { id: true, code: true, name: true } },
      dutyType: { select: { id: true, code: true, name: true } },
      versions: {
        where: {
          status: 'PUBLISHED',
          ...(query.formVersionId != null ? { id: query.formVersionId } : {}),
        },
        orderBy: { versionNumber: 'desc' },
        select: { id: true, versionNumber: true, schema: true, status: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  const items: Array<{
    formId: number;
    formName: string;
    formVersionId: number;
    versionNumber: number;
    crewType: { id: number; code: string; name: string } | null;
    dutyType: { id: number; code: string; name: string } | null;
    fieldId: string;
    fieldKey: string;
    label: string;
    type: FieldType;
    required: boolean;
    options: string[];
  }> = [];

  for (const form of forms) {
    for (const version of form.versions) {
      let fields: FormField[] = [];
      try {
        fields = parseFormSchema(version.schema).fields;
      } catch {
        continue;
      }
      for (const field of fields) {
        items.push({
          formId: form.id,
          formName: form.name,
          formVersionId: version.id,
          versionNumber: version.versionNumber,
          crewType: form.crewType,
          dutyType: form.dutyType,
          fieldId: field.id,
          fieldKey: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          options: field.options,
        });
      }
    }
  }
  return { items };
}

export interface RegisterEntriesFilter {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  crewTypeId?: number;
  dutyTypeId?: number;
  lobbyId?: number;
  userId?: number;
  status?: string;
  formId?: number;
  formVersionId?: number;
  page?: number;
  pageSize?: number;
}

function parseDateBound(value: string | undefined, end: boolean): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RmoError('Date is invalid.', 400);
  return new Date(end ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`);
}

function integerOpt(value: number | undefined, label: string): number | undefined {
  if (value == null) return undefined;
  if (!Number.isInteger(value)) throw new RmoError(`${label} is invalid.`, 400);
  return value;
}

function entryPassesVisibility(
  answers: Record<string, unknown>,
  fields: Array<{ fieldKey: string; isKeyField: boolean; formVersionId: number }>,
  formVersionId: number,
): boolean {
  const applicable = fields.filter(field => field.formVersionId === formVersionId);
  if (applicable.length === 0) return false;
  const keyFields = applicable.filter(field => field.isKeyField);
  if (keyFields.length > 0) {
    return keyFields.every(field => isNonEmptyAnswer(answers[field.fieldKey]));
  }
  return applicable.some(field => isNonEmptyAnswer(answers[field.fieldKey]));
}

async function loadMappings(registerId: number) {
  return prisma.registerField.findMany({
    where: { registerId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: fieldSelect,
  });
}

function buildSubmissionWhere(
  register: { divisionId: number },
  mappings: Array<{ formVersionId: number; formId: number }>,
  filter: RegisterEntriesFilter,
): Prisma.SubmissionWhereInput {
  const formVersionIds = [...new Set(mappings.map(m => m.formVersionId))];
  const dateFrom = parseDateBound(filter.dateFrom, false);
  const dateTo = parseDateBound(filter.dateTo, true);
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new RmoError('dateFrom cannot be after dateTo.', 400);
  }
  const crewTypeId = integerOpt(filter.crewTypeId, 'Crew type');
  const dutyTypeId = integerOpt(filter.dutyTypeId, 'Duty type');
  const lobbyId = integerOpt(filter.lobbyId, 'Lobby');
  const userId = integerOpt(filter.userId, 'User');
  const formId = integerOpt(filter.formId, 'Form');
  const formVersionId = integerOpt(filter.formVersionId, 'Form version');
  if (filter.status && filter.status !== 'PENDING' && filter.status !== 'COMPLETED') {
    throw new RmoError('Status must be PENDING or COMPLETED.', 400);
  }

  return {
    divisionId: register.divisionId,
    formVersionId: formVersionId
      ? formVersionId
      : formVersionIds.length
        ? { in: formVersionIds }
        : -1,
    ...(formId != null ? { formId } : {}),
    ...(crewTypeId != null ? { crewTypeId } : {}),
    ...(dutyTypeId != null ? { dutyTypeId } : {}),
    ...(lobbyId != null ? { lobbyId } : {}),
    ...(userId != null ? { submittedById: userId } : {}),
    ...(filter.status ? { status: filter.status as 'PENDING' | 'COMPLETED' } : {}),
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
}

export async function listRegisterEntries(
  actor: Actor,
  registerId: number,
  filter: RegisterEntriesFilter,
) {
  const register = await loadRegisterInScope(actor, registerId);
  const mappings = await loadMappings(registerId);
  const valueKeys = resolveValueKeys(mappings);
  const columns = mappings.map(field => ({
    key: valueKeys.get(field.id) || field.fieldKey,
    mappingId: field.id,
    header: field.columnLabel || field.fieldKey,
    fieldKey: field.fieldKey,
    fieldId: field.fieldId,
    formVersionId: field.formVersionId,
    isKeyField: field.isKeyField,
    sortOrder: field.sortOrder,
    sourceLabel: [
      field.crewType?.code,
      field.dutyType?.code,
      field.form.name,
      `v${field.formVersion.versionNumber}`,
    ]
      .filter(Boolean)
      .join(' / '),
  }));

  const page = Math.max(filter.page || 1, 1);
  const pageSize = Math.min(Math.max(filter.pageSize || 20, 1), 50);
  const filtersOut = {
    search: filter.search ?? null,
    dateFrom: filter.dateFrom ?? null,
    dateTo: filter.dateTo ?? null,
    crewTypeId: filter.crewTypeId ?? null,
    dutyTypeId: filter.dutyTypeId ?? null,
    lobbyId: filter.lobbyId ?? null,
    userId: filter.userId ?? null,
    status: filter.status ?? null,
    formId: filter.formId ?? null,
    formVersionId: filter.formVersionId ?? null,
  };

  if (mappings.length === 0) {
    return {
      register: {
        id: register.id,
        name: register.name,
        description: register.description,
        status: register.status,
        formId: register.formId,
        division: register.division,
      },
      columns,
      entries: [],
      total: 0,
      page,
      pageSize,
      filters: filtersOut,
    };
  }

  const where = buildSubmissionWhere(register, mappings, filter);
  const candidates = await prisma.submission.findMany({
    where,
    orderBy: { submittedAt: 'desc' },
    take: 5000,
    select: {
      id: true,
      formId: true,
      formVersionId: true,
      submittedAt: true,
      status: true,
      answers: true,
      lobby: { select: { id: true, name: true, code: true } },
      submittedBy: { select: { id: true, name: true, loginId: true, email: true } },
      crewType: { select: { id: true, code: true, name: true } },
      dutyType: { select: { id: true, code: true, name: true } },
      form: { select: { id: true, name: true } },
      formVersion: { select: { id: true, versionNumber: true } },
    },
  });

  const visible = candidates.filter(row => {
    const answers =
      row.answers && typeof row.answers === 'object' && !Array.isArray(row.answers)
        ? (row.answers as Record<string, unknown>)
        : {};
    return entryPassesVisibility(answers, mappings, row.formVersionId);
  });

  const total = visible.length;
  const pageRows = visible.slice((page - 1) * pageSize, page * pageSize);
  const entries = pageRows.map(row => {
    const answers =
      row.answers && typeof row.answers === 'object' && !Array.isArray(row.answers)
        ? (row.answers as Record<string, unknown>)
        : {};
    const values: Record<string, string> = {};
    for (const mapping of mappings) {
      const key = valueKeys.get(mapping.id) || mapping.fieldKey;
      values[key] =
        mapping.formVersionId === row.formVersionId
          ? answerText(answers[mapping.fieldKey])
          : '';
    }
    return {
      submissionId: row.id,
      submittedAt: row.submittedAt,
      status: row.status,
      lobby: row.lobby,
      submittedBy: row.submittedBy,
      crewType: row.crewType,
      dutyType: row.dutyType,
      form: row.form,
      formVersion: row.formVersion,
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
      division: register.division,
    },
    columns,
    entries,
    total,
    page,
    pageSize,
    filters: filtersOut,
  };
}

function startOfUtcDay(value = new Date()) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
function endOfUtcDay(value = new Date()) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 23, 59, 59, 999),
  );
}
function startOfUtcWeek(value = new Date()) {
  const day = startOfUtcDay(value);
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return day;
}
function startOfUtcMonth(value = new Date()) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

export async function registerAnalytics(
  actor: Actor,
  registerId: number,
  filter: RegisterEntriesFilter,
) {
  assertAnalyticsReader(actor);
  const data = await listRegisterEntries(actor, registerId, {
    ...filter,
    page: 1,
    pageSize: 5000,
  });
  const mappings = await loadMappings(registerId);
  const versionIds = [...new Set(mappings.map(m => m.formVersionId))];
  const versions = versionIds.length
    ? await prisma.formVersion.findMany({
        where: { id: { in: versionIds } },
        select: { id: true, schema: true },
      })
    : [];
  const fieldTypeByVersionKey = new Map<string, FieldType>();
  const optionsByVersionKey = new Map<string, string[]>();
  for (const version of versions) {
    try {
      const schema = parseFormSchema(version.schema);
      for (const field of schema.fields) {
        fieldTypeByVersionKey.set(`${version.id}:${field.key}`, field.type);
        optionsByVersionKey.set(`${version.id}:${field.key}`, field.options || []);
      }
    } catch {
      // ignore malformed schemas in analytics
    }
  }

  const now = new Date();
  const todayStart = startOfUtcDay(now).getTime();
  const todayEnd = endOfUtcDay(now).getTime();
  const weekStart = startOfUtcWeek(now).getTime();
  const monthStart = startOfUtcMonth(now).getTime();

  const crew = new Set<number>();
  const lobbies = new Set<number>();
  const byCrewType = new Map<string, number>();
  const byDutyType = new Map<string, number>();
  const byLobby = new Map<string, number>();
  const byCrew = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const byDay = new Map<string, number>();
  let today = 0;
  let week = 0;
  let month = 0;
  let completed = 0;
  let pending = 0;

  type NumericAgg = { total: number; count: number; min: number; max: number };
  type ChoiceAgg = Map<string, number>;
  const numericStats = new Map<string, NumericAgg>();
  const yesNoStats = new Map<string, ChoiceAgg>();
  const selectStats = new Map<string, ChoiceAgg>();

  for (const entry of data.entries) {
    const ts = new Date(entry.submittedAt).getTime();
    if (ts >= todayStart && ts <= todayEnd) today += 1;
    if (ts >= weekStart && ts <= todayEnd) week += 1;
    if (ts >= monthStart && ts <= todayEnd) month += 1;
    if (entry.status === 'COMPLETED') completed += 1;
    if (entry.status === 'PENDING') pending += 1;
    if (entry.submittedBy?.id) crew.add(entry.submittedBy.id);
    if (entry.lobby?.id) lobbies.add(entry.lobby.id);
    const day = formatCellDate(entry.submittedAt).slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
    const crewType = entry.crewType?.code || '—';
    const dutyType = entry.dutyType?.code || '—';
    const lobby = entry.lobby?.name || '—';
    const crewName = entry.submittedBy.loginId || entry.submittedBy.name;
    byCrewType.set(crewType, (byCrewType.get(crewType) || 0) + 1);
    byDutyType.set(dutyType, (byDutyType.get(dutyType) || 0) + 1);
    byLobby.set(lobby, (byLobby.get(lobby) || 0) + 1);
    byCrew.set(crewName, (byCrew.get(crewName) || 0) + 1);
    byStatus.set(entry.status, (byStatus.get(entry.status) || 0) + 1);

    for (const column of data.columns) {
      const raw = entry.values[column.key];
      if (!raw) continue;
      const type =
        fieldTypeByVersionKey.get(`${column.formVersionId}:${column.fieldKey}`) || 'TEXT';
      const label = column.header;
      if (type === 'NUMBER') {
        const num = Number(raw);
        if (!Number.isFinite(num)) continue;
        const current = numericStats.get(label) || {
          total: 0,
          count: 0,
          min: num,
          max: num,
        };
        current.total += num;
        current.count += 1;
        current.min = Math.min(current.min, num);
        current.max = Math.max(current.max, num);
        numericStats.set(label, current);
      } else if (type === 'YES_NO') {
        const bucket = yesNoStats.get(label) || new Map<string, number>();
        const key = /^(y|yes|true|1)$/i.test(raw) ? 'Yes' : /^(n|no|false|0)$/i.test(raw) ? 'No' : raw;
        bucket.set(key, (bucket.get(key) || 0) + 1);
        yesNoStats.set(label, bucket);
      } else if (type === 'SINGLE_SELECT' || type === 'RADIO' || type === 'MULTI_SELECT') {
        const bucket = selectStats.get(label) || new Map<string, number>();
        for (const part of raw.split(',').map(item => item.trim()).filter(Boolean)) {
          bucket.set(part, (bucket.get(part) || 0) + 1);
        }
        selectStats.set(label, bucket);
      }
    }
  }

  const toList = (map: Map<string, number>) =>
    Array.from(map.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

  const choiceBlocks = (source: Map<string, ChoiceAgg>) =>
    Array.from(source.entries()).map(([question, counts]) => {
      const total = Array.from(counts.values()).reduce((sum, n) => sum + n, 0);
      return {
        question,
        total,
        options: Array.from(counts.entries())
          .map(([label, count]) => ({
            label,
            count,
            percentage: total ? Math.round((count / total) * 1000) / 10 : 0,
          }))
          .sort((a, b) => b.count - a.count),
      };
    });

  return {
    metrics: {
      total: data.total,
      today,
      week,
      month,
      uniqueCrew: crew.size,
      uniqueLobbies: lobbies.size,
      completed,
      pending,
    },
    trend: {
      bucket: 'day',
      points: Array.from(byDay.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, count]) => ({ label, count })),
    },
    byCrewType: toList(byCrewType),
    byDutyType: toList(byDutyType),
    byLobby: toList(byLobby),
    byCrew: toList(byCrew).slice(0, 20),
    byStatus: toList(byStatus),
    fieldStats: {
      numeric: Array.from(numericStats.entries()).map(([question, stats]) => ({
        question,
        total: stats.total,
        average: stats.count ? Math.round((stats.total / stats.count) * 100) / 100 : 0,
        minimum: stats.min,
        maximum: stats.max,
        count: stats.count,
      })),
      yesNo: choiceBlocks(yesNoStats),
      select: choiceBlocks(selectStats),
    },
    filters: data.filters,
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
    { key: 'login_id', header: 'Staff Number', width: 16 },
    { key: 'name', header: 'Crew', width: 22 },
    { key: 'crew_type', header: 'Staff Type', width: 12 },
    { key: 'duty_type', header: 'Duty Type', width: 12 },
    { key: 'lobby', header: 'Lobby', width: 18 },
    { key: 'form', header: 'Form', width: 22 },
    { key: 'form_version', header: 'Form Version', width: 12 },
    { key: 'submitted_at', header: 'Submitted At', width: 20 },
    { key: 'status', header: 'Status', width: 12 },
  ];
  const mappedColumns: WorkbookColumn[] = pageData.columns.map(column => ({
    key: exportColumnKey(column.key, column.fieldKey),
    header: column.header,
    width: Math.max(18, Math.min(48, column.header.length + 6)),
  }));
  const columns = [...fixedColumns, ...mappedColumns];
  const rows = pageData.entries.map(entry => {
    const row: Record<string, unknown> = {
      login_id: entry.submittedBy.loginId || '',
      name: entry.submittedBy.name || '',
      crew_type: entry.crewType?.code || '',
      duty_type: entry.dutyType?.code || '',
      lobby: entry.lobby?.name || '',
      form: entry.form?.name || '',
      form_version: entry.formVersion?.versionNumber ?? '',
      submitted_at: formatCellDate(entry.submittedAt),
      status: entry.status,
    };
    for (const column of pageData.columns) {
      row[exportColumnKey(column.key, column.fieldKey)] = entry.values[column.key] || '';
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
    filters: Object.fromEntries(
      Object.entries(data.filters).map(([key, value]) => [key, value == null ? null : String(value)]),
    ),
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
  await recordAudit(actor.id, 'register.exported', 'register', registerId, {
    divisionId: data.register.division?.id ?? null,
    rowCount: data.rows.length,
    filters: data.filters,
  });
  return { buffer, filename: data.filename };
}

export async function exportRegisterCsv(
  actor: Actor,
  registerId: number,
  filter: RegisterEntriesFilter,
) {
  const data = await buildRegisterExportData(actor, registerId, filter);
  const escape = (value: unknown) => {
    const text = value == null ? '' : String(value);
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = data.columns.map(col => col.header);
  const lines = [header.map(escape).join(',')];
  for (const row of data.rows) {
    lines.push(data.columns.map(col => escape(row[col.key])).join(','));
  }
  await recordAudit(actor.id, 'register.exported', 'register', registerId, {
    divisionId: data.register.division?.id ?? null,
    rowCount: data.rows.length,
    format: 'csv',
  });
  return {
    csv: lines.join('\n'),
    filename: data.filename.replace(/\.xlsx$/i, '.csv'),
  };
}
