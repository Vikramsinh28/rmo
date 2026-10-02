import { prisma } from '@/lib/prisma';
import { Prisma } from '@/lib/prisma/generated/client';
import { parseFormSchema } from '@/lib/rmo/form-schema';
import type { FieldType, FormField, FormSchema } from '@/types/form';

export interface ClientFieldDef {
  key: string;
  isKeyField: boolean;
  label?: string;
  type?: FieldType;
}

export interface ClientFormDefinition {
  formName: string;
  registerName: string;
  description: string;
  keys: ClientFieldDef[];
}

const FIELD_META: Record<string, { label: string; type: FieldType }> = {
  date: { label: 'Date', type: 'DATE' },
  train_no: { label: 'Train No.', type: 'TEXT' },
  name: { label: 'Name', type: 'TEXT' },
  designation: { label: 'Designation', type: 'TEXT' },
  detonator_no: { label: 'Detonator No.', type: 'TEXT' },
  crew_sign: { label: 'Crew Sign', type: 'SIGNATURE' },
  return_yes_no: { label: 'Returned', type: 'YES_NO' },
  bc_sign: { label: 'BC Sign', type: 'SIGNATURE' },
  incident_description: { label: 'Incident Description', type: 'TEXTAREA' },
  section: { label: 'Section', type: 'TEXT' },
  km_range: { label: 'KM Range', type: 'TEXT' },
  time_range: { label: 'Time Range', type: 'TEXT' },
  loco_no: { label: 'Loco No.', type: 'TEXT' },
  lp_name: { label: 'LP Name', type: 'TEXT' },
  tm_name: { label: 'TM Name', type: 'TEXT' },
  alp_name: { label: 'ALP Name', type: 'TEXT' },
  on_duty_time: { label: 'On Duty Time', type: 'TIME' },
  off_duty_time: { label: 'Off Duty Time', type: 'TIME' },
  cro_notified_to: { label: 'CRO Notified To', type: 'TEXT' },
  hose_given_to_sse: { label: 'Hose Given to SSE', type: 'YES_NO' },
  hose_changed: { label: 'Hose Changed', type: 'YES_NO' },
  lp_sign: { label: 'LP Sign', type: 'SIGNATURE' },
  depot_sign: { label: 'Depot Sign', type: 'SIGNATURE' },
  cw_sign: { label: 'CW Sign', type: 'SIGNATURE' },
  remarks: { label: 'Remarks', type: 'TEXTAREA' },
  issue_datetime: { label: 'Issue Date/Time', type: 'DATETIME' },
  walkie_no: { label: 'Walkie No.', type: 'TEXT' },
  deposit_datetime: { label: 'Deposit Date/Time', type: 'DATETIME' },
  fog_no: { label: 'Fog Safe Device No.', type: 'TEXT' },
  returned: { label: 'Returned', type: 'YES_NO' },
};

/**
 * One published form per client register book.
 * Create these forms first; map registers afterward.
 */
export const CLIENT_FORM_DEFINITIONS: ClientFormDefinition[] = [
  {
    formName: 'Detonator Form',
    registerName: 'Detonator Register',
    description: 'Track detonators issued to crew and their return.',
    keys: [
      { key: 'date', isKeyField: false },
      { key: 'train_no', isKeyField: false },
      { key: 'name', isKeyField: false },
      { key: 'designation', isKeyField: false },
      { key: 'detonator_no', isKeyField: true },
      { key: 'crew_sign', isKeyField: false },
      { key: 'return_yes_no', isKeyField: false },
      { key: 'bc_sign', isKeyField: false },
    ],
  },
  {
    formName: 'Incident / Unusual Occurrence Form',
    registerName: 'Incident / Unusual Occurrence',
    description: 'Record abnormal events during a run.',
    keys: [
      { key: 'date', isKeyField: false },
      { key: 'incident_description', isKeyField: true },
      { key: 'section', isKeyField: false },
      { key: 'km_range', isKeyField: false },
      { key: 'time_range', isKeyField: false },
      { key: 'loco_no', isKeyField: false },
      { key: 'lp_name', isKeyField: false },
      { key: 'tm_name', isKeyField: false },
      { key: 'alp_name', isKeyField: false },
    ],
  },
  {
    formName: 'ALP Duty Form',
    registerName: 'ALP Duty Register',
    description: 'Record ALP on-duty and off-duty timings against a train.',
    keys: [
      { key: 'date', isKeyField: false },
      { key: 'alp_name', isKeyField: false },
      { key: 'train_no', isKeyField: false },
      { key: 'on_duty_time', isKeyField: true },
      { key: 'off_duty_time', isKeyField: false },
      { key: 'crew_sign', isKeyField: false },
    ],
  },
  {
    formName: 'BP/FP Air-Hose Pipe Change Form',
    registerName: 'BP/FP Air-Hose Pipe Change Register',
    description: 'Track BP/FP air-hose pipe replacement after CRO (Instruction No. 44).',
    keys: [
      { key: 'lp_name', isKeyField: false },
      { key: 'train_no', isKeyField: false },
      { key: 'loco_no', isKeyField: true },
      { key: 'cro_notified_to', isKeyField: false },
      { key: 'hose_given_to_sse', isKeyField: false },
      { key: 'hose_changed', isKeyField: false },
      { key: 'lp_sign', isKeyField: false },
      { key: 'depot_sign', isKeyField: false },
      { key: 'cw_sign', isKeyField: false },
      { key: 'remarks', isKeyField: false },
    ],
  },
  {
    formName: 'Walkie-Talkie Form',
    registerName: 'Walkie-Talkie Register',
    description: 'Track walkie-talkie sets issued to and deposited by crew.',
    keys: [
      { key: 'issue_datetime', isKeyField: false },
      { key: 'name', isKeyField: false },
      { key: 'designation', isKeyField: false },
      { key: 'walkie_no', isKeyField: true },
      { key: 'train_no', isKeyField: false },
      { key: 'crew_sign', isKeyField: false },
      { key: 'deposit_datetime', isKeyField: false },
      { key: 'bc_sign', isKeyField: false },
      { key: 'remarks', isKeyField: false },
    ],
  },
  {
    formName: 'Fog Safe Device Form',
    registerName: 'Fog Safe Device Register',
    description: 'Track fog safety devices issued to and returned by ALP.',
    keys: [
      { key: 'date', isKeyField: false },
      { key: 'train_no', isKeyField: false },
      { key: 'alp_name', isKeyField: false },
      { key: 'fog_no', isKeyField: true },
      { key: 'crew_sign', isKeyField: false },
      { key: 'returned', isKeyField: false },
    ],
  },
];

/** @deprecated Use CLIENT_FORM_DEFINITIONS — kept for register seed compatibility. */
export const CLIENT_REGISTER_DEFINITIONS = CLIENT_FORM_DEFINITIONS.map(def => ({
  name: def.registerName,
  description: def.description,
  keys: def.keys.map(item => ({ key: item.key, isKeyField: item.isKeyField })),
}));

function fieldFromKey(item: ClientFieldDef, order: number, section: string): FormField {
  const meta = FIELD_META[item.key];
  const type = item.type || meta?.type || 'TEXT';
  const label =
    item.label ||
    meta?.label ||
    item.key
      .split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  return {
    id: item.key,
    key: item.key,
    label,
    type,
    required: item.isKeyField,
    placeholder: '',
    helpText: '',
    options: [],
    validation: {},
    displayOrder: order,
    section,
  };
}

export function schemaForClientForm(definition: ClientFormDefinition): FormSchema {
  const section = 'General';
  return {
    sections: [section],
    fields: definition.keys.map((item, index) => fieldFromKey(item, index, section)),
  };
}

/** Combined schema (legacy single-form seed). Prefer per-book forms. */
export function clientRegisterFormSchema(): FormSchema {
  const keys = new Map<string, ClientFieldDef>();
  for (const definition of CLIENT_FORM_DEFINITIONS) {
    for (const item of definition.keys) {
      if (!keys.has(item.key)) keys.set(item.key, item);
    }
  }
  const section = 'Register fields';
  return {
    sections: [section],
    fields: Array.from(keys.values()).map((item, index) => fieldFromKey(item, index, section)),
  };
}

export async function seedClientFormsForDivision(options: {
  divisionId: number;
  createdById: number;
  assignDivisionWide?: boolean;
}) {
  const { divisionId, createdById, assignDivisionWide = true } = options;
  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    select: { id: true, name: true },
  });
  if (!division) throw new Error('Division was not found.');

  const results: Array<{
    formName: string;
    formId: number;
    created: boolean;
    fieldCount: number;
  }> = [];

  for (const definition of CLIENT_FORM_DEFINITIONS) {
    const existing = await prisma.form.findFirst({
      where: {
        divisionId,
        name: definition.formName,
        purpose: 'GENERAL',
      },
      select: {
        id: true,
        status: true,
        currentVersion: { select: { id: true, status: true } },
      },
    });

    if (existing) {
      if (assignDivisionWide) {
        const assignment = await prisma.formAssignment.findFirst({
          where: { formId: existing.id, divisionId, lobbyId: null },
          select: { id: true },
        });
        if (!assignment) {
          await prisma.formAssignment.create({
            data: { formId: existing.id, divisionId, lobbyId: null },
          });
        }
      }
      results.push({
        formName: definition.formName,
        formId: existing.id,
        created: false,
        fieldCount: definition.keys.length,
      });
      continue;
    }

    const schema = schemaForClientForm(definition);
    const form = await prisma.$transaction(async tx => {
      const created = await tx.form.create({
        data: {
          name: definition.formName,
          description: definition.description,
          divisionId,
          status: 'PUBLISHED',
          purpose: 'GENERAL',
          createdById,
        },
      });
      const version = await tx.formVersion.create({
        data: {
          formId: created.id,
          versionNumber: 1,
          status: 'PUBLISHED',
          createdById,
          schema: schema as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.form.update({
        where: { id: created.id },
        data: { currentVersionId: version.id },
      });
      if (assignDivisionWide) {
        await tx.formAssignment.create({
          data: { formId: created.id, divisionId, lobbyId: null },
        });
      }
      return created;
    });

    results.push({
      formName: definition.formName,
      formId: form.id,
      created: true,
      fieldCount: definition.keys.length,
    });
  }

  return { divisionId, divisionName: division.name, results };
}

export async function seedClientRegistersForDivision(options: {
  divisionId: number;
  createdById: number;
  forceRemap?: boolean;
}) {
  const { divisionId, createdById, forceRemap = false } = options;
  const forms = await seedClientFormsForDivision({ divisionId, createdById });
  const formByRegisterName = new Map<string, number>();
  for (const definition of CLIENT_FORM_DEFINITIONS) {
    const form = forms.results.find(row => row.formName === definition.formName);
    if (form) formByRegisterName.set(definition.registerName, form.formId);
  }

  const results: Array<{ name: string; registerId: number; formId: number; mapped: number; skipped: boolean }> =
    [];

  for (const definition of CLIENT_FORM_DEFINITIONS) {
    const formId = formByRegisterName.get(definition.registerName);
    if (formId == null) continue;

    const form = await prisma.form.findUnique({
      where: { id: formId },
      select: {
        id: true,
        currentVersion: { select: { schema: true, status: true } },
      },
    });
    if (!form?.currentVersion || form.currentVersion.status !== 'PUBLISHED') {
      throw new Error(`Form ${definition.formName} must be published.`);
    }
    const schema = parseFormSchema(form.currentVersion.schema);
    const available = new Set(schema.fields.map(field => field.key));

    let register = await prisma.register.findFirst({
      where: { divisionId, name: definition.registerName },
      select: { id: true },
    });
    if (!register) {
      register = await prisma.register.create({
        data: {
          name: definition.registerName,
          description: definition.description,
          divisionId,
          formId,
          status: 'ACTIVE',
          createdById,
        },
        select: { id: true },
      });
    }

    const existingCount = await prisma.registerField.count({ where: { registerId: register.id } });
    if (existingCount > 0 && !forceRemap) {
      results.push({
        name: definition.registerName,
        registerId: register.id,
        formId,
        mapped: existingCount,
        skipped: true,
      });
      continue;
    }

    const mappable = definition.keys.filter(item => available.has(item.key));
    await prisma.$transaction(async tx => {
      await tx.registerField.deleteMany({ where: { registerId: register!.id } });
      if (mappable.length > 0) {
        await tx.registerField.createMany({
          data: mappable.map((item, index) => ({
            registerId: register!.id,
            fieldKey: item.key,
            sortOrder: index,
            isKeyField: item.isKeyField,
            columnLabel: null,
          })),
        });
      }
    });

    results.push({
      name: definition.registerName,
      registerId: register.id,
      formId,
      mapped: mappable.length,
      skipped: false,
    });
  }

  return { forms: forms.results, results };
}
