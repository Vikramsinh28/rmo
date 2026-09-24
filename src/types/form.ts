export const FIELD_TYPES = [
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'DATE',
  'DATETIME',
  'TIME',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'YES_NO',
  'CHECKBOX',
  'RADIO',
  'FILE',
  'SIGNATURE',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldValidation {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface FormField {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  placeholder: string;
  helpText: string;
  options: string[];
  validation: FieldValidation;
  displayOrder: number;
  section: string;
}

export interface FormSchema {
  sections: string[];
  fields: FormField[];
}

export type AnswerValue = string | number | boolean | string[];

export type AnswerMap = Record<string, AnswerValue>;
