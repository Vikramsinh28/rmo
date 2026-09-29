import { prisma } from '@/lib/prisma';
import { Prisma, QuestionStatus } from '@/lib/prisma/generated/client';
import { RmoError } from '@/lib/rmo/errors';
import type { Actor } from '@/services/internal/rmo/administration';
import { recordAudit } from '@/services/internal/rmo/audit-event';
import { actorRole } from '@/services/internal/rmo/submission-scope';
import type { AnswerMap, AnswerValue, FieldType, FormField, FormSchema } from '@/types/form';
import { FormSchemaError, validateAnswers } from '@/lib/rmo/form-schema';

const DENIED = 'You do not have permission to perform this action.';

function assertSystemAdmin(actor: Actor) {
  if (actorRole(actor) !== 'SYSTEM_ADMIN') throw new RmoError(DENIED, 403);
}

function assertConfigReader(actor: Actor) {
  const role = actorRole(actor);
  if (
    role === 'SYSTEM_ADMIN' ||
    role === 'DIVISION_ADMIN' ||
    role === 'DIVISION_MONITOR' ||
    role === 'CREW_USER' ||
    role === 'LOBBY_USER'
  ) {
    return role;
  }
  throw new RmoError(DENIED, 403);
}

const configSelect = {
  id: true,
  questionId: true,
  crewTypeId: true,
  dutyTypeId: true,
  formVersionId: true,
  displayOrder: true,
  required: true,
  status: true,
  question: {
    select: {
      id: true,
      code: true,
      text: true,
      type: true,
      required: true,
      helpText: true,
      options: true,
      status: true,
      registers: {
        select: {
          registerTypeId: true,
          registerType: { select: { id: true, code: true, name: true, status: true } },
        },
      },
    },
  },
  crewType: { select: { id: true, code: true, name: true } },
  dutyType: { select: { id: true, code: true, name: true } },
} satisfies Prisma.QuestionConfigurationSelect;

export async function ensureCrewRegistrationForm(actorId?: number) {
  const existing = await prisma.form.findFirst({
    where: { purpose: 'CREW_REGISTRATION' },
    include: { currentVersion: true },
  });
  if (existing?.currentVersion) return existing;

  const adminId =
    actorId ??
    (
      await prisma.user.findFirst({
        where: { rmoRole: 'SYSTEM_ADMIN', deletedAt: null },
        select: { id: true },
      })
    )?.id;
  if (!adminId) throw new RmoError('System admin is required to create the crew form.', 500);

  return prisma.$transaction(async tx => {
    const form = await tx.form.create({
      data: {
        name: 'Crew Registration',
        description: 'Single crew registration form resolved by crew type and duty type.',
        purpose: 'CREW_REGISTRATION',
        status: 'PUBLISHED',
        createdById: adminId,
      },
    });
    const version = await tx.formVersion.create({
      data: {
        formId: form.id,
        versionNumber: 1,
        status: 'PUBLISHED',
        createdById: adminId,
        schema: { sections: ['Questions'], fields: [] },
      },
    });
    return tx.form.update({
      where: { id: form.id },
      data: { currentVersionId: version.id },
      include: { currentVersion: true },
    });
  });
}

export async function listQuestionConfigurations(
  actor: Actor,
  query: {
    crewTypeId?: number;
    dutyTypeId?: number;
    formVersionId?: number;
    status?: string;
  },
) {
  assertConfigReader(actor);
  if (query.crewTypeId == null || query.dutyTypeId == null) {
    throw new RmoError('Crew type and duty type are required.', 400);
  }
  const form = await ensureCrewRegistrationForm(actor.id);
  const formVersionId = query.formVersionId ?? form.currentVersionId;
  if (formVersionId == null) throw new RmoError('Crew registration form has no published version.', 400);
  const status =
    query.status === 'ACTIVE' || query.status === 'INACTIVE'
      ? (query.status as QuestionStatus)
      : undefined;
  const items = await prisma.questionConfiguration.findMany({
    where: {
      crewTypeId: query.crewTypeId,
      dutyTypeId: query.dutyTypeId,
      formVersionId,
      ...(status ? { status } : {}),
    },
    orderBy: { displayOrder: 'asc' },
    select: configSelect,
  });
  return {
    formId: form.id,
    formVersionId,
    items,
  };
}

export interface ConfigurationItemInput {
  questionId: number;
  displayOrder?: number;
  required?: boolean;
  status?: string;
}

export async function replaceQuestionConfigurations(
  actor: Actor,
  input: {
    crewTypeId?: number;
    dutyTypeId?: number;
    formVersionId?: number;
    items?: ConfigurationItemInput[];
  },
) {
  assertSystemAdmin(actor);
  if (input.crewTypeId == null || !Number.isInteger(input.crewTypeId)) {
    throw new RmoError('Crew type is required.', 400);
  }
  if (input.dutyTypeId == null || !Number.isInteger(input.dutyTypeId)) {
    throw new RmoError('Duty type is required.', 400);
  }
  const crewType = await prisma.crewType.findUnique({ where: { id: input.crewTypeId } });
  const dutyType = await prisma.dutyType.findUnique({ where: { id: input.dutyTypeId } });
  if (!crewType) throw new RmoError('Crew type was not found.', 400);
  if (!dutyType) throw new RmoError('Duty type was not found.', 400);

  const form = await ensureCrewRegistrationForm(actor.id);
  const formVersionId = input.formVersionId ?? form.currentVersionId;
  if (formVersionId == null) throw new RmoError('Crew registration form has no published version.', 400);

  const items = input.items ?? [];
  const questionIds = [...new Set(items.map(item => item.questionId).filter(id => Number.isInteger(id)))];
  if (questionIds.length !== items.length) {
    throw new RmoError('Each configuration item needs a valid question.', 400);
  }
  if (questionIds.length) {
    const found = await prisma.question.findMany({
      where: { id: { in: questionIds }, status: 'ACTIVE' },
      select: { id: true },
    });
    if (found.length !== questionIds.length) {
      throw new RmoError('One or more questions were not found or are inactive.', 400);
    }
  }

  await prisma.$transaction(async tx => {
    await tx.questionConfiguration.deleteMany({
      where: {
        crewTypeId: input.crewTypeId!,
        dutyTypeId: input.dutyTypeId!,
        formVersionId,
      },
    });
    if (items.length) {
      await tx.questionConfiguration.createMany({
        data: items.map((item, index) => ({
          questionId: item.questionId,
          crewTypeId: input.crewTypeId!,
          dutyTypeId: input.dutyTypeId!,
          formVersionId,
          displayOrder: item.displayOrder ?? index,
          required: Boolean(item.required),
          status:
            item.status === 'INACTIVE' ? 'INACTIVE' : ('ACTIVE' as QuestionStatus),
        })),
      });
    }
  });

  await recordAudit(actor.id, 'question_configuration.replaced', 'question_configuration', null, {
    crewTypeId: input.crewTypeId,
    dutyTypeId: input.dutyTypeId,
    formVersionId,
    count: items.length,
  });

  return listQuestionConfigurations(actor, {
    crewTypeId: input.crewTypeId,
    dutyTypeId: input.dutyTypeId,
    formVersionId,
  });
}

function optionsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item));
}

export function configurationsToSchema(
  configs: Array<Prisma.QuestionConfigurationGetPayload<{ select: typeof configSelect }>>,
  registerTypeId?: number,
): FormSchema {
  const filtered = registerTypeId
    ? configs.filter(config =>
        config.question.registers.some(row => row.registerTypeId === registerTypeId),
      )
    : configs;
  const fields: FormField[] = filtered
    .filter(config => config.status === 'ACTIVE' && config.question.status === 'ACTIVE')
    .map(config => ({
      id: String(config.question.id),
      key: config.question.code,
      label: config.question.text,
      type: config.question.type as FieldType,
      required: config.required || config.question.required,
      placeholder: '',
      helpText: config.question.helpText,
      options: optionsOf(config.question.options),
      validation: {},
      displayOrder: config.displayOrder,
      section: 'Questions',
    }));
  return { sections: ['Questions'], fields };
}

export async function resolveCrewFormQuestions(input: {
  crewTypeId: number;
  dutyTypeId: number;
  formVersionId?: number;
  registerTypeId?: number;
  includeInactive?: boolean;
}) {
  const form = await ensureCrewRegistrationForm();
  const formVersionId = input.formVersionId ?? form.currentVersionId;
  if (formVersionId == null) throw new RmoError('Crew registration form has no published version.', 400);
  const configs = await prisma.questionConfiguration.findMany({
    where: {
      crewTypeId: input.crewTypeId,
      dutyTypeId: input.dutyTypeId,
      formVersionId,
      ...(input.includeInactive ? {} : { status: 'ACTIVE' }),
      question: input.includeInactive ? undefined : { status: 'ACTIVE' },
    },
    orderBy: { displayOrder: 'asc' },
    select: configSelect,
  });
  return {
    form,
    formVersionId,
    configs,
    schema: configurationsToSchema(configs, input.registerTypeId),
  };
}

export async function previewCrewForm(
  actor: Actor,
  query: { crewTypeId?: number; dutyTypeId?: number; registerTypeId?: number },
) {
  assertConfigReader(actor);
  if (query.crewTypeId == null || query.dutyTypeId == null) {
    throw new RmoError('Crew type and duty type are required.', 400);
  }
  const resolved = await resolveCrewFormQuestions({
    crewTypeId: query.crewTypeId,
    dutyTypeId: query.dutyTypeId,
    registerTypeId: query.registerTypeId,
  });
  return {
    formId: resolved.form.id,
    formVersionId: resolved.formVersionId,
    crewTypeId: query.crewTypeId,
    dutyTypeId: query.dutyTypeId,
    registerTypeId: query.registerTypeId ?? null,
    schema: resolved.schema,
    questions: resolved.configs.map(config => ({
      configurationId: config.id,
      questionId: config.questionId,
      code: config.question.code,
      text: config.question.text,
      type: config.question.type,
      required: config.required || config.question.required,
      displayOrder: config.displayOrder,
      registers: config.question.registers.map(row => row.registerType),
    })),
  };
}

export function validateCrewAnswers(
  schema: FormSchema,
  answers: unknown,
): { answerMap: AnswerMap; rows: Array<{ questionId: number; answer: AnswerValue }> } {
  let answerMap: AnswerMap;
  try {
    answerMap = validateAnswers(schema, answers ?? {});
  } catch (error) {
    if (error instanceof FormSchemaError) throw new RmoError(error.message, 400);
    throw error;
  }
  const rows = schema.fields.map(field => ({
    questionId: Number(field.id),
    answer: answerMap[field.key],
  }));
  return { answerMap, rows };
}
