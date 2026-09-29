import { prisma } from '@/lib/prisma';
import { Prisma, QuestionStatus } from '@/lib/prisma/generated/client';
import { FIELD_TYPES, type FieldType } from '@/types/form';
import { RmoError } from '@/lib/rmo/errors';
import type { Actor } from '@/services/internal/rmo/administration';
import { recordAudit } from '@/services/internal/rmo/audit-event';
import { actorRole, assertFormManager, assertRecordReader } from '@/services/internal/rmo/submission-scope';

const DENIED = 'You do not have permission to perform this action.';

const questionSelect = {
  id: true,
  code: true,
  text: true,
  type: true,
  required: true,
  helpText: true,
  options: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  registers: {
    select: {
      id: true,
      registerTypeId: true,
      registerType: { select: { id: true, code: true, name: true, status: true } },
    },
  },
} satisfies Prisma.QuestionSelect;

function assertSystemAdmin(actor: Actor) {
  if (actorRole(actor) !== 'SYSTEM_ADMIN') throw new RmoError(DENIED, 403);
}

function normalizeCode(code: string | undefined) {
  const value = code?.trim().toUpperCase().replace(/\s+/g, '_');
  if (!value) throw new RmoError('Code is required.', 400);
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(value)) {
    throw new RmoError('Code must be uppercase letters, numbers, or underscores.', 400);
  }
  return value;
}

function normalizeType(type: string | undefined): FieldType {
  if (!type || !(FIELD_TYPES as readonly string[]).includes(type)) {
    throw new RmoError('Question type is invalid.', 400);
  }
  return type as FieldType;
}

function normalizeStatus(status: string | undefined): QuestionStatus | undefined {
  if (status == null) return undefined;
  if (status !== 'ACTIVE' && status !== 'INACTIVE') {
    throw new RmoError('Status must be ACTIVE or INACTIVE.', 400);
  }
  return status;
}

function normalizeOptions(options: unknown): string[] {
  if (options == null) return [];
  if (!Array.isArray(options)) throw new RmoError('Options must be an array.', 400);
  return options.map(item => String(item).trim()).filter(Boolean);
}

export async function listQuestions(
  actor: Actor,
  query: { search?: string; status?: string; page?: number; pageSize?: number },
) {
  assertRecordReader(actor);
  const page = Math.max(query.page || 1, 1);
  const pageSize = Math.min(Math.max(query.pageSize || 50, 1), 100);
  const status = normalizeStatus(query.status);
  const where: Prisma.QuestionWhereInput = {
    ...(status ? { status } : {}),
    ...(query.search
      ? {
          OR: [
            { text: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.question.findMany({
      where,
      orderBy: [{ status: 'asc' }, { code: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: questionSelect,
    }),
    prisma.question.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getQuestion(actor: Actor, id: number) {
  assertRecordReader(actor);
  if (!Number.isInteger(id)) throw new RmoError('Question not found.', 404);
  const row = await prisma.question.findUnique({ where: { id }, select: questionSelect });
  if (!row) throw new RmoError('Question not found.', 404);
  return row;
}

export interface QuestionWriteInput {
  code?: string;
  text?: string;
  type?: string;
  required?: boolean;
  helpText?: string;
  options?: unknown;
  status?: string;
}

export async function createQuestion(actor: Actor, input: QuestionWriteInput) {
  assertSystemAdmin(actor);
  const code = normalizeCode(input.code);
  const text = input.text?.trim();
  if (!text) throw new RmoError('Question text is required.', 400);
  const type = normalizeType(input.type);
  try {
    const row = await prisma.question.create({
      data: {
        code,
        text,
        type,
        required: Boolean(input.required),
        helpText: input.helpText?.trim() ?? '',
        options: normalizeOptions(input.options),
        status: normalizeStatus(input.status) ?? 'ACTIVE',
        createdById: actor.id,
      },
      select: questionSelect,
    });
    await recordAudit(actor.id, 'question.created', 'question', row.id, { code, text, type });
    return row;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new RmoError('A question with this code already exists.', 409);
    }
    throw error;
  }
}

export async function updateQuestion(actor: Actor, id: number, input: QuestionWriteInput) {
  assertSystemAdmin(actor);
  if (!Number.isInteger(id)) throw new RmoError('Question not found.', 404);
  const existing = await prisma.question.findUnique({ where: { id }, select: questionSelect });
  if (!existing) throw new RmoError('Question not found.', 404);
  const data: Prisma.QuestionUpdateInput = {};
  if (input.code !== undefined) data.code = normalizeCode(input.code);
  if (input.text !== undefined) {
    const text = input.text.trim();
    if (!text) throw new RmoError('Question text is required.', 400);
    data.text = text;
  }
  if (input.type !== undefined) data.type = normalizeType(input.type);
  if (input.required !== undefined) data.required = Boolean(input.required);
  if (input.helpText !== undefined) data.helpText = input.helpText.trim();
  if (input.options !== undefined) data.options = normalizeOptions(input.options);
  if (input.status !== undefined) data.status = normalizeStatus(input.status);
  if (!Object.keys(data).length) return existing;
  try {
    const row = await prisma.question.update({ where: { id }, data, select: questionSelect });
    await recordAudit(actor.id, 'question.updated', 'question', id, { before: existing, after: row });
    return row;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new RmoError('A question with this code already exists.', 409);
    }
    throw error;
  }
}

export async function setQuestionRegisters(
  actor: Actor,
  questionId: number,
  registerTypeIds: number[],
) {
  assertFormManager(actor);
  if (actorRole(actor) !== 'SYSTEM_ADMIN') throw new RmoError(DENIED, 403);
  if (!Number.isInteger(questionId)) throw new RmoError('Question not found.', 404);
  const question = await prisma.question.findUnique({ where: { id: questionId }, select: { id: true } });
  if (!question) throw new RmoError('Question not found.', 404);
  const ids = [...new Set(registerTypeIds.filter(id => Number.isInteger(id)))];
  if (ids.length) {
    const found = await prisma.registerType.findMany({
      where: { id: { in: ids }, status: 'ACTIVE' },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new RmoError('One or more register types were not found or are inactive.', 400);
    }
  }
  await prisma.$transaction([
    prisma.questionRegister.deleteMany({ where: { questionId } }),
    ...(ids.length
      ? [
          prisma.questionRegister.createMany({
            data: ids.map(registerTypeId => ({ questionId, registerTypeId })),
          }),
        ]
      : []),
  ]);
  await recordAudit(actor.id, 'question.registers_updated', 'question', questionId, {
    registerTypeIds: ids,
  });
  return getQuestion(actor, questionId);
}
