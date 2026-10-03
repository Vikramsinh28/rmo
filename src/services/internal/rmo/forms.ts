import { prisma } from '@/lib/prisma';
import { Prisma } from '@/lib/prisma/generated/client';
import { FormSchemaError, emptySchema, parseFormSchema } from '@/lib/rmo/form-schema';
import { RmoError } from '@/lib/rmo/errors';
import type { FormSchema } from '@/types/form';
import type { Actor } from '@/services/internal/rmo/administration';
import { recordAudit } from '@/services/internal/rmo/audit-event';
import {
  actorRole,
  assertFormManager,
  assignedFormIds,
  crewFormIds,
  rejectForeignDivision,
} from '@/services/internal/rmo/submission-scope';

const DENIED = 'You do not have permission to perform this action.';
const NOT_FOUND = 'Form not found.';

const detailInclude = {
  division: { select: { id: true, name: true, code: true } },
  crewType: { select: { id: true, code: true, name: true, isActive: true } },
  dutyType: { select: { id: true, code: true, name: true, isActive: true } },
  createdBy: { select: { id: true, name: true, loginId: true } },
  versions: { orderBy: { versionNumber: 'asc' as const } },
  assignments: {
    include: {
      division: { select: { id: true, name: true } },
      lobby: { select: { id: true, name: true } },
    },
    orderBy: { id: 'asc' as const },
  },
  registers: {
    where: { status: 'ACTIVE' as const },
    select: { id: true, name: true, status: true },
    orderBy: { name: 'asc' as const },
  },
} satisfies Prisma.FormInclude;

export interface AssignmentInput {
  divisionId: number;
  lobbyId?: number | null;
}

export interface FormWriteInput {
  name?: string;
  description?: string;
  divisionId?: number | null;
  systemWide?: boolean;
  crewTypeId?: number | null;
  dutyTypeId?: number | null;
  schema?: unknown;
  assignments?: AssignmentInput[];
}

function schemaFrom(value: unknown): FormSchema {
  try {
    return parseFormSchema(value);
  } catch (error) {
    if (error instanceof FormSchemaError) throw new RmoError(error.message, 400);
    throw error;
  }
}

function present(form: Prisma.FormGetPayload<{ include: typeof detailInclude }>) {
  const draft = [...form.versions].reverse().find(version => version.status === 'DRAFT');
  const current = form.versions.find(version => version.id === form.currentVersionId);
  const editable = draft || current || form.versions[form.versions.length - 1];
  return {
    id: form.id,
    name: form.name,
    description: form.description,
    divisionId: form.divisionId,
    crewTypeId: form.crewTypeId,
    dutyTypeId: form.dutyTypeId,
    status: form.status,
    currentVersionId: form.currentVersionId,
    createdById: form.createdById,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt,
    division: form.division,
    crewType: form.crewType,
    dutyType: form.dutyType,
    createdBy: form.createdBy,
    registers: form.registers,
    schema: editable ? schemaFrom(editable.schema) : emptySchema(),
    editableVersion: editable
      ? {
          id: editable.id,
          versionNumber: editable.versionNumber,
          status: editable.status,
        }
      : null,
    versions: form.versions.map(version => ({
      id: version.id,
      versionNumber: version.versionNumber,
      status: version.status,
      createdAt: version.createdAt,
      createdById: version.createdById,
    })),
    assignments: form.assignments.map(assignment => ({
      id: assignment.id,
      divisionId: assignment.divisionId,
      lobbyId: assignment.lobbyId,
      division: assignment.division,
      lobby: assignment.lobby,
    })),
  };
}

async function loadForm(id: number) {
  const form = await prisma.form.findUnique({ where: { id }, include: detailInclude });
  if (!form) throw new RmoError(NOT_FOUND, 404);
  return form;
}

async function resolveTypeIds(input: {
  crewTypeId?: number | null;
  dutyTypeId?: number | null;
}): Promise<{ crewTypeId: number | null; dutyTypeId: number | null }> {
  let crewTypeId: number | null =
    input.crewTypeId === undefined ? null : input.crewTypeId;
  let dutyTypeId: number | null =
    input.dutyTypeId === undefined ? null : input.dutyTypeId;

  if (crewTypeId != null) {
    if (!Number.isInteger(crewTypeId)) throw new RmoError('Crew type is invalid.', 400);
    const crewType = await prisma.crewType.findUnique({
      where: { id: crewTypeId },
      select: { id: true, isActive: true },
    });
    if (!crewType || !crewType.isActive) {
      throw new RmoError('Crew type was not found or is inactive.', 400);
    }
    crewTypeId = crewType.id;
  }
  if (dutyTypeId != null) {
    if (!Number.isInteger(dutyTypeId)) throw new RmoError('Duty type is invalid.', 400);
    const dutyType = await prisma.dutyType.findUnique({
      where: { id: dutyTypeId },
      select: { id: true, isActive: true },
    });
    if (!dutyType || !dutyType.isActive) {
      throw new RmoError('Duty type was not found or is inactive.', 400);
    }
    dutyTypeId = dutyType.id;
  }
  if ((crewTypeId == null) !== (dutyTypeId == null)) {
    throw new RmoError('Crew type and duty type must both be set or both be cleared.', 400);
  }
  return { crewTypeId, dutyTypeId };
}

async function syncRegisterFieldMappings(
  formId: number,
  divisionId: number | null,
  schema: FormSchema,
  meta?: {
    formVersionId?: number | null;
    crewTypeId?: number | null;
    dutyTypeId?: number | null;
  },
) {
  if (divisionId == null) return;
  const mapped = schema.fields.filter(
    field => field.registerId != null && Number.isInteger(field.registerId),
  );
  if (mapped.length === 0) return;

  const registerIds = [...new Set(mapped.map(field => field.registerId as number))];
  const registers = await prisma.register.findMany({
    where: { id: { in: registerIds }, divisionId },
    select: { id: true },
  });
  if (registers.length !== registerIds.length) {
    throw new RmoError('One or more register mappings are invalid for this form.', 400);
  }

  const form = await prisma.form.findUnique({
    where: { id: formId },
    select: {
      id: true,
      currentVersionId: true,
      crewTypeId: true,
      dutyTypeId: true,
    },
  });
  const formVersionId = meta?.formVersionId ?? form?.currentVersionId;
  if (!formVersionId) {
    throw new RmoError('A published form version is required for register mapping.', 400);
  }

  for (const registerId of registerIds) {
    const fieldsForRegister = mapped.filter(field => field.registerId === registerId);
    await prisma.registerField.deleteMany({
      where: { registerId, formVersionId },
    });
    if (fieldsForRegister.length === 0) continue;
    await prisma.registerField.createMany({
      data: fieldsForRegister.map((field, index) => ({
        registerId,
        formId,
        formVersionId,
        fieldId: field.id,
        fieldKey: field.key,
        crewTypeId: meta?.crewTypeId ?? form?.crewTypeId ?? null,
        dutyTypeId: meta?.dutyTypeId ?? form?.dutyTypeId ?? null,
        sortOrder: index,
        columnLabel: field.label,
        isKeyField: false,
      })),
    });
  }
}

async function assertCanRead(
  actor: Actor,
  form: {
    id: number;
    divisionId: number | null;
    status: string;
    crewTypeId: number | null;
    dutyTypeId: number | null;
  },
  options?: { dutyTypeId?: number },
) {
  const role = actorRole(actor);
  if (role === 'SYSTEM_ADMIN') return;
  if (role === 'DIVISION_ADMIN' || role === 'DIVISION_MONITOR') {
    if (form.divisionId !== actor.homeDivisionId) throw new RmoError(DENIED, 403);
    return;
  }
  if (role === 'LOBBY_USER') {
    if (form.status !== 'PUBLISHED') throw new RmoError(NOT_FOUND, 404);
    if (form.crewTypeId != null || form.dutyTypeId != null) {
      throw new RmoError(NOT_FOUND, 404);
    }
    const allowed = await assignedFormIds(actor);
    if (!allowed.includes(form.id)) throw new RmoError(NOT_FOUND, 404);
    return;
  }
  if (role === 'CREW_USER') {
    if (form.status !== 'PUBLISHED') throw new RmoError(NOT_FOUND, 404);
    if (
      form.crewTypeId == null ||
      form.dutyTypeId == null ||
      form.divisionId == null ||
      !actor.crewTypeId ||
      form.divisionId !== actor.homeDivisionId ||
      form.crewTypeId !== actor.crewTypeId
    ) {
      throw new RmoError(NOT_FOUND, 404);
    }
    if (options?.dutyTypeId != null && form.dutyTypeId !== options.dutyTypeId) {
      throw new RmoError(NOT_FOUND, 404);
    }
    return;
  }
  throw new RmoError(DENIED, 403);
}

async function normalizeAssignments(
  actor: Actor,
  formDivisionId: number | null,
  input: AssignmentInput[],
) {
  const rows: Array<{ divisionId: number; lobbyId: number | null }> = [];
  const seen = new Set<string>();
  for (const item of input) {
    const divisionId = Number(item.divisionId);
    const lobbyId = item.lobbyId == null || item.lobbyId === undefined ? null : Number(item.lobbyId);
    if (!Number.isInteger(divisionId)) throw new RmoError('Division is invalid.', 400);
    if (lobbyId != null && !Number.isInteger(lobbyId)) throw new RmoError('Lobby is invalid.', 400);
    if (actor.rmoRole !== 'SYSTEM_ADMIN' && divisionId !== actor.homeDivisionId) {
      throw new RmoError(DENIED, 403);
    }
    if (formDivisionId != null && divisionId !== formDivisionId) {
      throw new RmoError(DENIED, 403);
    }
    const division = await prisma.division.findUnique({
      where: { id: divisionId },
      select: { id: true },
    });
    if (!division) throw new RmoError('Division was not found.', 400);
    if (lobbyId != null) {
      const lobby = await prisma.lobby.findUnique({
        where: { id: lobbyId },
        select: { id: true, divisionId: true },
      });
      if (!lobby) throw new RmoError('Lobby was not found.', 400);
      if (lobby.divisionId !== divisionId) throw new RmoError(DENIED, 403);
    }
    const key = `${divisionId}:${lobbyId ?? 'division'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ divisionId, lobbyId });
  }
  return rows;
}

async function replaceAssignments(
  formId: number,
  rows: Array<{ divisionId: number; lobbyId: number | null }>,
) {
  await prisma.$transaction(async tx => {
    await tx.formAssignment.deleteMany({ where: { formId } });
    if (rows.length > 0) {
      await tx.formAssignment.createMany({
        data: rows.map(row => ({ formId, divisionId: row.divisionId, lobbyId: row.lobbyId })),
      });
    }
  });
}

async function storeSchema(formId: number, actorId: number, schema: FormSchema) {
  const versions = await prisma.formVersion.findMany({
    where: { formId },
    orderBy: { versionNumber: 'desc' },
    include: { _count: { select: { submissions: true } } },
  });
  const draft = versions.find(version => version.status === 'DRAFT');
  if (draft) {
    if (draft._count.submissions > 0) {
      throw new RmoError(
        'This version has submissions and cannot be edited. Create a new version instead.',
        409,
      );
    }
    await prisma.formVersion.update({
      where: { id: draft.id },
      data: { schema: schema as unknown as Prisma.InputJsonValue },
    });
    return { created: false, versionId: draft.id, versionNumber: draft.versionNumber };
  }
  const latest = versions[0];
  const versionNumber = (latest?.versionNumber ?? 0) + 1;
  const created = await prisma.formVersion.create({
    data: {
      formId,
      versionNumber,
      schema: schema as unknown as Prisma.InputJsonValue,
      status: 'DRAFT',
      createdById: actorId,
    },
  });
  if (!latest) {
    await prisma.form.update({
      where: { id: formId },
      data: { currentVersionId: created.id },
    });
  }
  return { created: true, versionId: created.id, versionNumber };
}

export async function listForms(
  actor: Actor,
  query: {
    search?: string;
    status?: string;
    divisionId?: number;
    dutyTypeId?: number;
    crewTypeId?: number;
    page?: number;
    pageSize?: number;
  },
) {
  const role = actorRole(actor);
  if (query.divisionId != null && !Number.isInteger(query.divisionId)) {
    throw new RmoError('Division is invalid.', 400);
  }
  if (query.dutyTypeId != null && !Number.isInteger(query.dutyTypeId)) {
    throw new RmoError('Duty type is invalid.', 400);
  }
  if (query.crewTypeId != null && !Number.isInteger(query.crewTypeId)) {
    throw new RmoError('Crew type is invalid.', 400);
  }
  rejectForeignDivision(actor, query.divisionId);
  const page = Math.max(query.page || 1, 1);
  const pageSize = Math.min(Math.max(query.pageSize || 20, 1), 50);
  const where: Prisma.FormWhereInput = {
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    ...(query.status === 'DRAFT' || query.status === 'PUBLISHED' || query.status === 'ARCHIVED'
      ? { status: query.status }
      : {}),
  };
  if (role === 'SYSTEM_ADMIN') {
    if (query.divisionId != null) where.divisionId = query.divisionId;
    if (query.crewTypeId != null) where.crewTypeId = query.crewTypeId;
    if (query.dutyTypeId != null) where.dutyTypeId = query.dutyTypeId;
  } else if (role === 'DIVISION_ADMIN' || role === 'DIVISION_MONITOR') {
    where.divisionId = actor.homeDivisionId ?? -1;
    if (query.crewTypeId != null) where.crewTypeId = query.crewTypeId;
    if (query.dutyTypeId != null) where.dutyTypeId = query.dutyTypeId;
  } else if (role === 'LOBBY_USER') {
    const ids = await assignedFormIds(actor);
    where.id = { in: ids.length ? ids : [-1] };
    where.status = 'PUBLISHED';
  } else if (role === 'CREW_USER') {
    if (query.dutyTypeId == null) {
      throw new RmoError('Duty type is required.', 400);
    }
    if (!actor.crewTypeId || !actor.homeDivisionId) {
      throw new RmoError(DENIED, 403);
    }
    // Never trust client-supplied crewType or division.
    const ids = await crewFormIds(actor, query.dutyTypeId);
    where.id = { in: ids.length ? ids : [-1] };
    where.status = 'PUBLISHED';
  } else {
    throw new RmoError(DENIED, 403);
  }
  const [items, total] = await Promise.all([
    prisma.form.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        description: true,
        divisionId: true,
        crewTypeId: true,
        dutyTypeId: true,
        status: true,
        currentVersionId: true,
        createdAt: true,
        updatedAt: true,
        division: { select: { id: true, name: true, code: true } },
        crewType: { select: { id: true, code: true, name: true } },
        dutyType: { select: { id: true, code: true, name: true } },
        currentVersion: {
          select: {
            id: true,
            versionNumber: true,
            status: true,
            schema: true,
          },
        },
        _count: { select: { submissions: true, assignments: true } },
      },
    }),
    prisma.form.count({ where }),
  ]);

  if (role === 'CREW_USER' && total > 1) {
    throw new RmoError(
      'Multiple published forms match this crew type and duty type. Contact an administrator.',
      409,
    );
  }

  return {
    items: items.map(item => {
      let questionCount = 0;
      if (item.currentVersion?.schema) {
        try {
          questionCount = schemaFrom(item.currentVersion.schema).fields.length;
        } catch {
          questionCount = 0;
        }
      }
      const { currentVersion, ...rest } = item;
      return {
        ...rest,
        currentVersion: currentVersion
          ? {
              id: currentVersion.id,
              versionNumber: currentVersion.versionNumber,
              status: currentVersion.status,
            }
          : null,
        questionCount,
      };
    }),
    total,
    page,
    pageSize,
  };
}

export async function getForm(actor: Actor, id: number, options?: { dutyTypeId?: number }) {
  if (!Number.isInteger(id)) throw new RmoError(NOT_FOUND, 404);
  const form = await loadForm(id);
  await assertCanRead(actor, form, options);
  return present(form);
}

async function resolveDivision(actor: Actor, input: FormWriteInput): Promise<number | null> {
  assertFormManager(actor);
  if (actor.rmoRole === 'DIVISION_ADMIN') {
    if (input.systemWide) throw new RmoError(DENIED, 403);
    if (input.divisionId != null && input.divisionId !== actor.homeDivisionId) {
      throw new RmoError(DENIED, 403);
    }
    return actor.homeDivisionId;
  }
  if (input.systemWide) return null;
  if (input.divisionId == null || !Number.isInteger(input.divisionId)) {
    throw new RmoError('A division is required unless the form is system-wide.', 400);
  }
  const division = await prisma.division.findUnique({
    where: { id: input.divisionId },
    select: { id: true },
  });
  if (!division) throw new RmoError('Division was not found.', 400);
  return division.id;
}

export async function createForm(actor: Actor, input: FormWriteInput) {
  const divisionId = await resolveDivision(actor, input);
  const name = input.name?.trim();
  if (!name) throw new RmoError('Name is required.', 400);
  const description = input.description?.trim() ?? '';
  const schema = schemaFrom(input.schema ?? emptySchema());
  const types = await resolveTypeIds({
    crewTypeId: input.crewTypeId,
    dutyTypeId: input.dutyTypeId,
  });
  if (types.crewTypeId != null && divisionId == null) {
    throw new RmoError('Crew forms must belong to a division.', 400);
  }
  const assignments = input.assignments
    ? await normalizeAssignments(actor, divisionId, input.assignments)
    : [];
  const form = await prisma.$transaction(async tx => {
    const created = await tx.form.create({
      data: {
        name,
        description,
        divisionId,
        crewTypeId: types.crewTypeId,
        dutyTypeId: types.dutyTypeId,
        status: 'DRAFT',
        createdById: actor.id,
      },
    });
    const version = await tx.formVersion.create({
      data: {
        formId: created.id,
        versionNumber: 1,
        schema: schema as unknown as Prisma.InputJsonValue,
        status: 'DRAFT',
        createdById: actor.id,
      },
    });
    await tx.form.update({
      where: { id: created.id },
      data: { currentVersionId: version.id },
    });
    if (assignments.length > 0) {
      await tx.formAssignment.createMany({
        data: assignments.map(row => ({
          formId: created.id,
          divisionId: row.divisionId,
          lobbyId: row.lobbyId,
        })),
      });
    }
    return { formId: created.id, versionId: version.id };
  });
  await syncRegisterFieldMappings(form.formId, divisionId, schema, {
    formVersionId: form.versionId,
    crewTypeId: types.crewTypeId,
    dutyTypeId: types.dutyTypeId,
  });
  await recordAudit(actor.id, 'form.created', 'form', form.formId, {
    divisionId,
    name,
    crewTypeId: types.crewTypeId,
    dutyTypeId: types.dutyTypeId,
  });
  await recordAudit(actor.id, 'form.version_created', 'form_version', form.versionId, {
    divisionId,
    versionNumber: 1,
  });
  return getForm(actor, form.formId);
}

export async function updateForm(actor: Actor, id: number, input: FormWriteInput) {
  assertFormManager(actor);
  const existing = await loadForm(id);
  await assertCanRead(actor, existing);
  if (actor.rmoRole !== 'SYSTEM_ADMIN' && existing.divisionId !== actor.homeDivisionId) {
    throw new RmoError(DENIED, 403);
  }
  if (existing.status === 'ARCHIVED') throw new RmoError('Archived forms cannot be edited.', 400);
  if (input.divisionId != null && input.divisionId !== existing.divisionId) {
    throw new RmoError(DENIED, 403);
  }
  const name = input.name?.trim();
  if (input.name != null && !name) throw new RmoError('Name is required.', 400);
  let types = {
    crewTypeId: existing.crewTypeId,
    dutyTypeId: existing.dutyTypeId,
  };
  if (input.crewTypeId !== undefined || input.dutyTypeId !== undefined) {
    types = await resolveTypeIds({
      crewTypeId: input.crewTypeId !== undefined ? input.crewTypeId : existing.crewTypeId,
      dutyTypeId: input.dutyTypeId !== undefined ? input.dutyTypeId : existing.dutyTypeId,
    });
    if (types.crewTypeId != null && existing.divisionId == null) {
      throw new RmoError('Crew forms must belong to a division.', 400);
    }
  }
  let versionMeta: { created: boolean; versionId: number; versionNumber: number } | null = null;
  let savedSchema: FormSchema | null = null;
  if (input.schema !== undefined) {
    savedSchema = schemaFrom(input.schema);
    versionMeta = await storeSchema(id, actor.id, savedSchema);
  }
  if (input.assignments) {
    const rows = await normalizeAssignments(actor, existing.divisionId, input.assignments);
    await replaceAssignments(id, rows);
  }
  await prisma.form.update({
    where: { id },
    data: {
      ...(name ? { name } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(input.crewTypeId !== undefined || input.dutyTypeId !== undefined
        ? { crewTypeId: types.crewTypeId, dutyTypeId: types.dutyTypeId }
        : {}),
    },
  });
  if (savedSchema) {
    await syncRegisterFieldMappings(id, existing.divisionId, savedSchema, {
      formVersionId: versionMeta?.versionId ?? existing.currentVersionId,
      crewTypeId: types.crewTypeId,
      dutyTypeId: types.dutyTypeId,
    });
  }
  await recordAudit(actor.id, 'form.updated', 'form', id, {
    divisionId: existing.divisionId,
    name: name || existing.name,
    crewTypeId: types.crewTypeId,
    dutyTypeId: types.dutyTypeId,
  });
  if (versionMeta?.created) {
    await recordAudit(actor.id, 'form.version_created', 'form_version', versionMeta.versionId, {
      divisionId: existing.divisionId,
      formId: id,
      versionNumber: versionMeta.versionNumber,
    });
  }
  const form = await getForm(actor, id);
  return { ...form, versionCreated: versionMeta?.created ?? false };
}

export async function publishForm(actor: Actor, id: number) {
  assertFormManager(actor);
  const existing = await loadForm(id);
  if (actor.rmoRole !== 'SYSTEM_ADMIN' && existing.divisionId !== actor.homeDivisionId) {
    throw new RmoError(DENIED, 403);
  }
  if (existing.status === 'ARCHIVED') throw new RmoError('Archived forms cannot be published.', 400);
  if (
    (existing.crewTypeId == null) !== (existing.dutyTypeId == null) ||
    (existing.crewTypeId != null && existing.divisionId == null)
  ) {
    throw new RmoError(
      'Crew forms require division, crew type, and duty type before publishing.',
      400,
    );
  }
  if (existing.crewTypeId != null && existing.dutyTypeId != null && existing.divisionId != null) {
    const conflict = await prisma.form.findFirst({
      where: {
        id: { not: id },
        status: 'PUBLISHED',
        divisionId: existing.divisionId,
        crewTypeId: existing.crewTypeId,
        dutyTypeId: existing.dutyTypeId,
      },
      select: { id: true, name: true },
    });
    if (conflict) {
      throw new RmoError(
        `Another published form already exists for this division, crew type, and duty type (${conflict.name}).`,
        409,
      );
    }
  }
  const draft = [...existing.versions].reverse().find(version => version.status === 'DRAFT');
  if (!draft) {
    if (existing.status === 'PUBLISHED') return present(existing);
    throw new RmoError('Add at least one field before publishing.', 400);
  }
  const schema = schemaFrom(draft.schema);
  if (schema.fields.length === 0) {
    throw new RmoError('Add at least one field before publishing.', 400);
  }
  try {
    await prisma.$transaction(async tx => {
      await tx.formVersion.updateMany({
        where: { formId: id, status: 'PUBLISHED' },
        data: { status: 'SUPERSEDED' },
      });
      await tx.formVersion.update({ where: { id: draft.id }, data: { status: 'PUBLISHED' } });
      await tx.form.update({
        where: { id },
        data: { status: 'PUBLISHED', currentVersionId: draft.id },
      });
    });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code: string }).code === 'P2002'
    ) {
      throw new RmoError(
        'Another published form already exists for this division, crew type, and duty type.',
        409,
      );
    }
    throw error;
  }
  await recordAudit(actor.id, 'form.published', 'form', id, {
    divisionId: existing.divisionId,
    versionId: draft.id,
    versionNumber: draft.versionNumber,
    crewTypeId: existing.crewTypeId,
    dutyTypeId: existing.dutyTypeId,
  });
  return getForm(actor, id);
}

export async function archiveForm(actor: Actor, id: number) {
  assertFormManager(actor);
  const existing = await loadForm(id);
  if (actor.rmoRole !== 'SYSTEM_ADMIN' && existing.divisionId !== actor.homeDivisionId) {
    throw new RmoError(DENIED, 403);
  }
  await prisma.form.update({ where: { id }, data: { status: 'ARCHIVED' } });
  await recordAudit(actor.id, 'form.archived', 'form', id, { divisionId: existing.divisionId });
  return getForm(actor, id);
}

export async function createFormVersion(actor: Actor, id: number, input: { schema?: unknown }) {
  assertFormManager(actor);
  const existing = await loadForm(id);
  if (actor.rmoRole !== 'SYSTEM_ADMIN' && existing.divisionId !== actor.homeDivisionId) {
    throw new RmoError(DENIED, 403);
  }
  if (existing.status === 'ARCHIVED') throw new RmoError('Archived forms cannot be versioned.', 400);
  const openDraft = existing.versions.find(version => version.status === 'DRAFT');
  if (openDraft) {
    throw new RmoError('A draft version already exists. Publish it or keep editing that draft.', 409);
  }
  const current = existing.versions.find(version => version.id === existing.currentVersionId);
  const schema = schemaFrom(input.schema ?? current?.schema ?? emptySchema());
  const versionNumber = Math.max(0, ...existing.versions.map(version => version.versionNumber)) + 1;
  const created = await prisma.formVersion.create({
    data: {
      formId: id,
      versionNumber,
      schema: schema as unknown as Prisma.InputJsonValue,
      status: 'DRAFT',
      createdById: actor.id,
    },
  });
  await recordAudit(actor.id, 'form.version_created', 'form_version', created.id, {
    divisionId: existing.divisionId,
    formId: id,
    versionNumber,
  });
  return getForm(actor, id);
}
