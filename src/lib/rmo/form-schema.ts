import {
  FIELD_TYPES,
  type AnswerMap,
  type AnswerValue,
  type FieldType,
  type FieldValidation,
  type FormField,
  type FormSchema,
} from '@/types/form';

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;
const CHOICE_TYPES: ReadonlySet<FieldType> = new Set(['SINGLE_SELECT', 'MULTI_SELECT', 'RADIO']);

export class FormSchemaError extends Error {}

export function emptySchema(): FormSchema {
  return { sections: ['General'], fields: [] };
}

export function blankField(order: number, section = 'General'): FormField {
  return {
    id: crypto.randomUUID(),
    key: `field_${order + 1}`,
    label: 'New field',
    type: 'TEXT',
    required: false,
    placeholder: '',
    helpText: '',
    options: [],
    validation: {},
    displayOrder: order,
    section,
  };
}

function fail(message: string): never {
  throw new FormSchemaError(message);
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(message);
  return value as Record<string, unknown>;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function parseValidation(value: unknown): FieldValidation {
  if (value == null) return {};
  const record = asRecord(value, 'Field validation must be an object.');
  const validation: FieldValidation = {};
  for (const key of ['min', 'max', 'minLength', 'maxLength'] as const) {
    if (record[key] == null || record[key] === '') continue;
    const number = Number(record[key]);
    if (!Number.isFinite(number)) fail(`Validation ${key} must be a number.`);
    validation[key] = number;
  }
  if (validation.min != null && validation.max != null && validation.min > validation.max) {
    fail('Validation min cannot be greater than max.');
  }
  if (
    validation.minLength != null &&
    validation.maxLength != null &&
    validation.minLength > validation.maxLength
  ) {
    fail('Validation minLength cannot be greater than maxLength.');
  }
  if (record.pattern != null && record.pattern !== '') {
    const pattern = text(record.pattern);
    if (!pattern || pattern.length > 80) fail('Validation pattern must be 1 to 80 characters.');
    try {
      RegExp(pattern);
    } catch {
      fail('Validation pattern is not a valid regular expression.');
    }
    validation.pattern = pattern;
  }
  return validation;
}

function parseField(value: unknown, index: number): FormField {
  const record = asRecord(value, 'Each field must be an object.');
  const type = text(record.type).toUpperCase();
  if (!(FIELD_TYPES as readonly string[]).includes(type)) {
    fail(`Field type must be one of ${FIELD_TYPES.join(', ')}.`);
  }
  const key = text(record.key).toLowerCase();
  if (!KEY_PATTERN.test(key)) {
    fail('Field key must be a lowercase slug using letters, numbers, and underscores.');
  }
  const label = text(record.label);
  if (!label) fail('Each field needs a label.');
  const section = text(record.section) || 'General';
  const options = Array.isArray(record.options)
    ? record.options.map(option => text(option)).filter(Boolean)
    : [];
  if (CHOICE_TYPES.has(type as FieldType) && options.length === 0) {
    fail(`${label} needs at least one option.`);
  }
  if (new Set(options).size !== options.length) fail(`${label} has duplicate options.`);
  return {
    id: text(record.id) || `field_${index + 1}`,
    key,
    label,
    type: type as FieldType,
    required: record.required === true,
    placeholder: text(record.placeholder),
    helpText: text(record.helpText ?? record.help_text),
    options,
    validation: parseValidation(record.validation),
    displayOrder: Number.isFinite(Number(record.displayOrder)) ? Number(record.displayOrder) : index,
    section,
  };
}

export function parseFormSchema(value: unknown): FormSchema {
  if (value == null) return emptySchema();
  const record = asRecord(value, 'Form schema must be an object.');
  const rawFields = Array.isArray(record.fields) ? record.fields : [];
  const fields = rawFields
    .map((field, index) => parseField(field, index))
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map((field, index) => ({ ...field, displayOrder: index }));
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const field of fields) {
    if (keys.has(field.key)) fail(`Field key ${field.key} is used more than once.`);
    if (ids.has(field.id)) fail('Each field needs a unique id.');
    keys.add(field.key);
    ids.add(field.id);
  }
  const declared = Array.isArray(record.sections)
    ? record.sections.map(section => text(section)).filter(Boolean)
    : [];
  const sections = [...declared];
  for (const field of fields) {
    if (!sections.includes(field.section)) sections.push(field.section);
  }
  if (sections.length === 0) sections.push('General');
  return { sections, fields };
}

function dateValid(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(part => Number(part));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function matchesPattern(value: string, pattern: string | undefined): boolean {
  if (!pattern) return true;
  return new RegExp(pattern).test(value);
}

function normalizeField(field: FormField, raw: unknown): AnswerValue | undefined {
  const label = field.label;
  const empty =
    raw == null ||
    raw === '' ||
    (Array.isArray(raw) && raw.length === 0);
  if (empty) {
    if (field.required) fail(`${label} is required.`);
    return undefined;
  }

  if (field.type === 'YES_NO' || field.type === 'CHECKBOX') {
    if (typeof raw !== 'boolean') fail(`${label} must be yes or no.`);
    return raw;
  }

  if (field.type === 'NUMBER') {
    const number = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(number)) fail(`${label} must be a number.`);
    if (field.validation.min != null && number < field.validation.min) {
      fail(`${label} must be at least ${field.validation.min}.`);
    }
    if (field.validation.max != null && number > field.validation.max) {
      fail(`${label} must be at most ${field.validation.max}.`);
    }
    return number;
  }

  if (field.type === 'MULTI_SELECT') {
    if (!Array.isArray(raw) || raw.some(item => typeof item !== 'string')) {
      fail(`${label} must be a list of options.`);
    }
    const selected = [...new Set(raw.map(item => item.trim()).filter(Boolean))];
    if (field.required && selected.length === 0) fail(`${label} is required.`);
    const unknown = selected.find(item => !field.options.includes(item));
    if (unknown) fail(`${label} includes an option that is not allowed.`);
    return selected;
  }

  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    if (field.required) fail(`${label} is required.`);
    return undefined;
  }

  if (field.type === 'TEXT' || field.type === 'TEXTAREA') {
    const min = field.validation.minLength;
    const max = field.validation.maxLength ?? (field.type === 'TEXTAREA' ? 4000 : 500);
    if (min != null && value.length < min) fail(`${label} is too short.`);
    if (value.length > max) fail(`${label} is too long.`);
    if (!matchesPattern(value, field.validation.pattern)) fail(`${label} has an invalid format.`);
    return value;
  }

  if (field.type === 'DATE') {
    if (!dateValid(value)) fail(`${label} must be a date in YYYY-MM-DD.`);
    return value;
  }
  if (field.type === 'TIME') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail(`${label} must be a time in HH:MM.`);
    return value;
  }
  if (field.type === 'DATETIME') {
    if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      fail(`${label} must be a date and time.`);
    }
    if (!dateValid(value.slice(0, 10))) fail(`${label} must be a valid date and time.`);
    return value;
  }
  if (field.type === 'SINGLE_SELECT' || field.type === 'RADIO') {
    if (!field.options.includes(value)) fail(`${label} must use one of the listed options.`);
    return value;
  }
  if (field.type === 'FILE') {
    if (value.length > 255) fail(`${label} file name is too long.`);
    return value;
  }
  if (value.length > 300000) fail(`${label} is too long.`);
  return value;
}

export function validateAnswers(schema: FormSchema, answers: unknown): AnswerMap {
  const record = asRecord(answers ?? {}, 'Answers must be an object.');
  const known = new Set(schema.fields.map(field => field.key));
  for (const key of Object.keys(record)) {
    if (!known.has(key)) fail(`Unknown answer key ${key}.`);
  }
  const normalized: AnswerMap = {};
  for (const field of schema.fields) {
    const value = normalizeField(field, record[field.key]);
    if (value !== undefined) normalized[field.key] = value;
  }
  return normalized;
}

export function groupFields(schema: FormSchema): Array<{ section: string; fields: FormField[] }> {
  return schema.sections
    .map(section => ({
      section,
      fields: schema.fields.filter(field => field.section === section),
    }))
    .filter(group => group.fields.length > 0);
}
