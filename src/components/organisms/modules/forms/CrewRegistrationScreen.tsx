'use client';

import { Button } from '@/components/ui/button';
import { apiRequest } from '@/components/organisms/modules/administration/api';
import type { AnswerMap, FormSchema } from '@/types/form';
import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { clientErrors, FormFields, TableSkeleton } from './form-ui';
import { useAuthStore } from '@/store/auth';

interface DutyType {
  id: number;
  code: string;
  name: string;
}

interface Preview {
  schema: FormSchema;
  formId: number;
}

export function CrewRegistrationScreen() {
  const router = useRouter();
  const user = useAuthStore(state => state.user);
  const [dutyTypes, setDutyTypes] = useState<DutyType[]>([]);
  const [dutyTypeId, setDutyTypeId] = useState('');
  const [crewTypeLabel, setCrewTypeLabel] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<{
      crewTypeId: number | null;
      dutyTypes: DutyType[];
      preview: Preview | null;
    }>('/api/crew/registration')
      .then(async result => {
        setDutyTypes(result.dutyTypes);
        if (result.crewTypeId) {
          const crew = await apiRequest<{ name: string; code: string }>(
            `/api/admin/crew-types/${result.crewTypeId}`,
          );
          setCrewTypeLabel(`${crew.code} — ${crew.name}`);
        }
      })
      .catch(cause => toast.error(cause instanceof Error ? cause.message : 'Unable to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!dutyTypeId) {
      setPreview(null);
      return;
    }
    apiRequest<{ preview: Preview | null }>(`/api/crew/registration?dutyTypeId=${dutyTypeId}`)
      .then(result => {
        setPreview(result.preview);
        setAnswers({});
        setErrors({});
      })
      .catch(cause => toast.error(cause instanceof Error ? cause.message : 'Unable to load form'));
  }, [dutyTypeId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!preview) return;
    const nextErrors = clientErrors(preview.schema, answers);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    try {
      const created = await apiRequest<{ id: number }>('/api/submissions', {
        method: 'POST',
        body: JSON.stringify({
          dutyTypeId: Number(dutyTypeId),
          answers,
        }),
      });
      toast.success('Registration submitted');
      router.push(`/submissions/${created.id}`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Submit failed');
    }
  };

  if (loading) {
    return (
      <div className="px-4 lg:px-6">
        <TableSkeleton />
      </div>
    );
  }

  return (
    <form className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 lg:px-6" onSubmit={submit}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Crew Registration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One form. Your crew type comes from your profile. Choose a duty type to load questions.
        </p>
      </div>
      <dl className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Crew</dt>
          <dd className="font-medium">{user?.name || '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Crew Type</dt>
          <dd className="font-medium">{crewTypeLabel || 'Not assigned'}</dd>
        </div>
      </dl>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="duty-type">
          Duty Type
        </label>
        <select
          id="duty-type"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={dutyTypeId}
          onChange={event => setDutyTypeId(event.target.value)}
          required
        >
          <option value="">Select duty type</option>
          {dutyTypes.map(row => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </div>
      {preview ? (
        <>
          <h2 className="text-lg font-medium">Questions</h2>
          {errors.form ? <p className="text-sm text-destructive">{errors.form}</p> : null}
          <FormFields
            schema={preview.schema}
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
          <Button type="submit" className="h-9 w-fit">
            Submit Registration
          </Button>
        </>
      ) : dutyTypeId ? (
        <p className="text-sm text-muted-foreground">No questions configured for this duty type.</p>
      ) : null}
    </form>
  );
}
