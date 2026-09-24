'use client';

import { FormSchemaError, groupFields, validateAnswers } from '@/lib/rmo/form-schema';
import type { AnswerMap, AnswerValue, FormField, FormSchema } from '@/types/form';
import { FormEvent, useEffect, useRef } from 'react';

export function TableSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="h-12 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    DRAFT: 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50',
    PUBLISHED: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    ARCHIVED: 'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200',
    ACTIVE: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    INACTIVE: 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50',
    PENDING: 'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200',
    APPROVED: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    REJECTED: 'bg-rose-100 text-rose-950 dark:bg-rose-950 dark:text-rose-200',
    CANCELLED: 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50',
    COMPLETED: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    SUPERSEDED: 'bg-sky-100 text-sky-950 dark:bg-sky-950 dark:text-sky-200',
  };
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] || styles.DRAFT}`}>
      {label}
    </span>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-card px-6 py-14 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function fieldValue(field: FormField, answers: AnswerMap): AnswerValue | undefined {
  return answers[field.key];
}

function SignaturePad({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value.startsWith('data:')) return;
    const image = new Image();
    image.onload = () => {
      const context = canvas.getContext('2d');
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = value;
  }, [value]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    drawing.current = true;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const { x, y } = point(event);
    context.strokeStyle = '#111827';
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(x, y);
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const { x, y } = point(event);
    context.lineTo(x, y);
    context.stroke();
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL('image/png'));
  };

  if (disabled && value.startsWith('data:')) {
    return <img src={value} alt="Signature" className="h-28 rounded-md border bg-white" />;
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={640}
        height={160}
        className="h-28 w-full rounded-md border bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      {disabled ? null : (
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => {
            const canvas = canvasRef.current;
            const context = canvas?.getContext('2d');
            if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
            onChange('');
          }}
        >
          Clear signature
        </button>
      )}
    </div>
  );
}

function ChoiceControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: FormField;
  value: AnswerValue | undefined;
  disabled?: boolean;
  onChange: (value: AnswerValue) => void;
}) {
  if (field.type === 'MULTI_SELECT') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-2">
        {field.options.map(option => (
          <label key={option} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={disabled}
              checked={selected.includes(option)}
              onChange={event => {
                const next = event.target.checked
                  ? [...selected, option]
                  : selected.filter(item => item !== option);
                onChange(next);
              }}
            />
            {option}
          </label>
        ))}
      </div>
    );
  }
  if (field.type === 'RADIO') {
    return (
      <div className="space-y-2">
        {field.options.map(option => (
          <label key={option} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={field.key}
              disabled={disabled}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            {option}
          </label>
        ))}
      </div>
    );
  }
  return (
    <select
      aria-label={field.label}
      disabled={disabled}
      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
      value={typeof value === 'string' ? value : ''}
      onChange={event => onChange(event.target.value)}
    >
      <option value="">Select</option>
      {field.options.map(option => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  );
}

export function FormFields({
  schema,
  answers,
  errors,
  readOnly,
  onChange,
}: {
  schema: FormSchema;
  answers: AnswerMap;
  errors?: Record<string, string>;
  readOnly?: boolean;
  onChange?: (key: string, value: AnswerValue | '') => void;
}) {
  const groups = groupFields(schema);
  return (
    <div className="space-y-6">
      {groups.map(group => (
        <section key={group.section} className="rounded-xl border bg-card">
          <h3 className="border-b px-4 py-3 text-sm font-medium">{group.section}</h3>
          <div className="space-y-4 px-4 py-4">
            {group.fields.map(field => {
              const value = fieldValue(field, answers);
              const error = errors?.[field.key];
              const change = (next: AnswerValue | '') => onChange?.(field.key, next);
              return (
                <div key={field.id}>
                  <label className="mb-1 block text-sm font-medium">
                    {field.label}
                    {field.required ? <span className="text-destructive"> *</span> : null}
                  </label>
                  {field.type === 'TEXTAREA' ? (
                    <textarea
                      aria-label={field.label}
                      disabled={readOnly}
                      placeholder={field.placeholder}
                      className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={typeof value === 'string' ? value : ''}
                      onChange={event => change(event.target.value)}
                    />
                  ) : null}
                  {field.type === 'TEXT' || field.type === 'NUMBER' || field.type === 'DATE' || field.type === 'TIME' || field.type === 'DATETIME' ? (
                    <input
                      aria-label={field.label}
                      disabled={readOnly}
                      placeholder={field.placeholder}
                      type={field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : field.type === 'TIME' ? 'time' : field.type === 'DATETIME' ? 'datetime-local' : 'text'}
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      value={value == null ? '' : String(value)}
                      onChange={event => {
                        if (field.type === 'NUMBER') {
                          change(event.target.value === '' ? '' : Number(event.target.value));
                          return;
                        }
                        change(event.target.value);
                      }}
                    />
                  ) : null}
                  {field.type === 'YES_NO' || field.type === 'CHECKBOX' ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={readOnly}
                        checked={value === true}
                        onChange={event => change(event.target.checked)}
                      />
                      {field.type === 'YES_NO' ? 'Yes' : field.placeholder || 'Checked'}
                    </label>
                  ) : null}
                  {field.type === 'SINGLE_SELECT' || field.type === 'MULTI_SELECT' || field.type === 'RADIO' ? (
                    <ChoiceControl field={field} value={value} disabled={readOnly} onChange={change} />
                  ) : null}
                  {field.type === 'FILE' ? (
                    readOnly ? (
                      <p className="text-sm">{typeof value === 'string' ? value : 'No file'}</p>
                    ) : (
                      <input
                        aria-label={field.label}
                        type="file"
                        className="text-sm"
                        onChange={event => change(event.target.files?.[0]?.name || '')}
                      />
                    )
                  ) : null}
                  {field.type === 'SIGNATURE' ? (
                    <SignaturePad
                      value={typeof value === 'string' ? value : ''}
                      disabled={readOnly}
                      onChange={change}
                    />
                  ) : null}
                  {field.helpText ? <p className="mt-1 text-xs text-muted-foreground">{field.helpText}</p> : null}
                  {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export function clientErrors(schema: FormSchema, answers: AnswerMap): Record<string, string> {
  try {
    validateAnswers(schema, answers);
    return {};
  } catch (error) {
    if (error instanceof FormSchemaError) return { form: error.message };
    return { form: 'Check the form and try again.' };
  }
}

export function preventSubmit(event: FormEvent) {
  event.preventDefault();
}
