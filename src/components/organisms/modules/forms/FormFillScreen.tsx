'use client';

import { Button } from '@/components/ui/button';
import { apiRequest } from '@/components/organisms/modules/administration/api';
import type { AnswerMap, FormSchema } from '@/types/form';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { clientErrors, FormFields, TableSkeleton } from './form-ui';

interface LoadedForm {
  id: number;
  name: string;
  description: string;
  status: string;
  schema: FormSchema;
}

export function FormFillScreen({ formId }: { formId: number }) {
  const router = useRouter();
  const [form, setForm] = useState<LoadedForm | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest<LoadedForm>(`/api/admin/forms/${formId}`)
      .then(result => {
        setForm(result);
        setError('');
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load form'))
      .finally(() => setLoading(false));
  }, [formId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    const nextErrors = clientErrors(form.schema, answers);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    try {
      const created = await apiRequest<{ id: number }>('/api/submissions', {
        method: 'POST',
        body: JSON.stringify({ formId: form.id, answers }),
      });
      toast.success('Submission saved');
      router.push(`/submissions/${created.id}`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Submit failed');
    }
  };

  if (loading) {
    return <div className="px-4 lg:px-6"><TableSkeleton /></div>;
  }
  if (error || !form) return <p className="px-4 text-sm text-destructive lg:px-6">{error || 'Form not found'}</p>;

  return (
    <form className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 lg:px-6" onSubmit={submit}>
      <div>
        <Link href="/forms" className="text-xs text-muted-foreground underline">Forms</Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{form.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{form.description}</p>
      </div>
      {errors.form ? <p className="text-sm text-destructive">{errors.form}</p> : null}
      <FormFields
        schema={form.schema}
        answers={answers}
        errors={errors}
        onChange={(key, value) => {
          setAnswers(current => {
            const next = { ...current };
            if (value === '') delete next[key];
            else next[key] = value;
            return next;
          });
        }}
      />
      <Button type="submit" className="h-9 w-fit">Submit</Button>
    </form>
  );
}
