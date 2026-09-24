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
  rejectForeignDivision,
} from '@/services/internal/rmo/submission-scope';

const DENIED = 'You do not have permission to perform this action.';

const detailInclude = {
  division: { select: { id: true, name: true, code: true } },
  createdBy: { select: { id: true, name: true, loginId: true } },
  versions: { orderBy: { versionNumber: 'asc' as const } },
  assignments: {
    include: {
      division: { select: { id: true, name: true } },
      lobby: { select: { id: true, name: true } },
    },
    orderBy: { id: 'asc' as const },
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
    status: form.status,
    currentVersionId: form.currentVersionId,
    createdById: form.createdById,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt,
    division: form.division,
    createdBy: form.createdBy,
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
  if (!form) throw new RmoError('Form not found.', 404);
  return form;
}

async function assertCanRead(actor: Actor, form: { id: number; divisionId: number | null; status: string }) {
  const role = actorRole(actor);
  if (role === 'SYSTEM_ADMIN') return;
  if (role === 'DIVISION_ADMIN' || role === 'DIVISION_MONITOR') {
    if (form.divisionId !== actor.homeDivisionId) throw new RmoError(DENIED, 403);
    return;
  }
  if (role === 'LOBBY_USER' || role === 'CREW_USER') {
    if (form.status !== 'PUBLISHED') throw new RmoError(DENIED, 403);
    const allowed = await assignedFormIds(actor);
    if (!allowed.includes(form.id)) throw new RmoError(DENIED, 403);
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
  query: { search?: string; status?: string; divisionId?: number; page?: number; pageSize?: number },
) {
  const role = actorRole(actor);
  if (query.divisionId != null && !Number.isInteger(query.divisionId)) {
    throw new RmoError('Division is invalid.', 400);
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
  } else if (role === 'DIVISION_ADMIN' || role === 'DIVISION_MONITOR') {
    where.divisionId = actor.homeDivisionId ?? -1;
  } else if (role === 'LOBBY_USER' || role === 'CREW_USER') {
    const ids = await assignedFormIds(actor);
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
        status: true,
        currentVersionId: true,
        createdAt: true,
        updatedAt: true,
        division: { select: { id: true, name: true, code: true } },
        currentVersion: { select: { id: true, versionNumber: true, status: true } },
        _count: { select: { submissions: true, assignments: true } },
      },
    }),
    prisma.form.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getForm(actor: Actor, id: number) {
  if (!Number.isInteger(id)) throw new RmoError('Form not found.', 404);
  const form = await loadForm(id);
  await assertCanRead(actor, form);
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
  const assignments = input.assignments
    ? await normalizeAssignments(actor, divisionId, input.assignments)
    : [];
  const form = await prisma.$transaction(async tx => {
    const created = await tx.form.create({
      data: {
        name,
        description,
        divisionId,
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
    return created.id;
  });
  await recordAudit(actor.id, 'form.created', 'form', form, { divisionId, name });
  await recordAudit(actor.id, 'form.version_created', 'form_version', form, {
    divisionId,
    versionNumber: 1,
  });
  return getForm(actor, form);
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
  let versionMeta: { created: boolean; versionId: number; versionNumber: number } | null = null;
  if (input.schema !== undefined) {
    versionMeta = await storeSchema(id, actor.id, schemaFrom(input.schema));
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
    },
  });
  await recordAudit(actor.id, 'form.updated', 'form', id, {
    divisionId: existing.divisionId,
    name: name || existing.name,
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
  const draft = [...existing.versions].reverse().find(version => version.status === 'DRAFT');
  if (!draft) {
    if (existing.status === 'PUBLISHED') return present(existing);
    throw new RmoError('Add at least one field before publishing.', 400);
  }
  const schema = schemaFrom(draft.schema);
  if (schema.fields.length === 0) {
    throw new RmoError('Add at least one field before publishing.', 400);
  }
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
  await recordAudit(actor.id, 'form.published', 'form', id, {
    divisionId: existing.divisionId,
    versionId: draft.id,
    versionNumber: draft.versionNumber,
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
