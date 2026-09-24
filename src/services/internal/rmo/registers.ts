import { prisma } from '@/lib/prisma';
import { Prisma, RegisterStatus } from '@/lib/prisma/generated/client';
import { RmoError } from '@/lib/rmo/errors';
import type { Actor } from '@/services/internal/rmo/administration';
import { recordAudit } from '@/services/internal/rmo/audit-event';
import {
  assertFormManager,
  assertRecordReader,
  rejectForeignDivision,
} from '@/services/internal/rmo/submission-scope';

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
} satisfies Prisma.RegisterSelect;

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
  assertRecordReader(actor);
  const register = await prisma.register.findUnique({ where: { id }, select: registerSelect });
  if (!register) throw new RmoError('Register not found.', 404);
  if (actor.rmoRole !== 'SYSTEM_ADMIN' && register.divisionId !== actor.homeDivisionId) {
    throw new RmoError(DENIED, 403);
  }
  return register;
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
