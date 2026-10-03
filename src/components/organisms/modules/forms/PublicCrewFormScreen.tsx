'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  clientErrors,
  FormFields,
} from '@/components/organisms/modules/forms/form-ui';
import type { AnswerMap, FormSchema } from '@/types/form';
import { FormEvent, useEffect, useMemo, useState } from 'react';

interface LobbyContext {
  lobbyName: string;
  divisionName: string;
  title: string;
}

interface DutyType {
  id: number;
  code: string;
  name: string;
}

interface IdentifyResult {
  publicSessionToken: string;
  crew: {
    name: string;
    staffNumber: string | null;
    crewType: { id: number; code: string; name: string } | null;
  };
  lobby: { name: string; divisionName: string };
  dutyTypes: DutyType[];
}

interface FormPayload {
  form: {
    name: string;
    description: string;
    questionCount: number;
    schema: FormSchema;
    dutyType: { id: number; code: string; name: string } | null;
    crewType: { id: number; code: string; name: string } | null;
  };
  alreadySubmitted: {
    reference: string | null;
    submittedAt: string;
    formName: string;
    dutyType: string;
  } | null;
}

interface SubmitResult {
  message: string;
  reference: string | null;
  formName: string;
  dutyType: string;
  crewType: string;
  submittedAt: string;
}

async function publicJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const payload = (await response.json()) as {
    success: boolean;
    message?: string;
    data?: T;
  };
  if (!response.ok || !payload.success) {
    throw new Error(payload.message || 'Request failed');
  }
  return payload.data as T;
}

export function PublicCrewFormScreen({ token }: { token: string }) {
  const [context, setContext] = useState<LobbyContext | null>(null);
  const [bootError, setBootError] = useState('');
  const [staffNumber, setStaffNumber] = useState('');
  const [email, setEmail] = useState('');
  const [identifyError, setIdentifyError] = useState('');
  const [identifying, setIdentifying] = useState(false);
  const [session, setSession] = useState<IdentifyResult | null>(null);
  const [dutyTypeId, setDutyTypeId] = useState<number | ''>('');
  const [formPayload, setFormPayload] = useState<FormPayload | null>(null);
  const [formError, setFormError] = useState('');
  const [loadingForm, setLoadingForm] = useState(false);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  useEffect(() => {
    publicJson<LobbyContext>(`/api/public/crew-form/${encodeURIComponent(token)}`)
      .then(data => {
        setContext(data);
        setBootError('');
      })
      .catch(error => {
        setBootError(error instanceof Error ? error.message : 'Invalid lobby link');
      });
  }, [token]);

  const sessionPath = useMemo(() => {
    if (!session) return '';
    return `/api/public/crew-form/session/${encodeURIComponent(session.publicSessionToken)}`;
  }, [session]);

  useEffect(() => {
    if (!session || !dutyTypeId || !sessionPath) {
      setFormPayload(null);
      return;
    }
    setLoadingForm(true);
    setFormError('');
    setAnswers({});
    setFieldErrors({});
    publicJson<FormPayload>(`${sessionPath}/form?dutyTypeId=${dutyTypeId}`)
      .then(data => setFormPayload(data))
      .catch(error => {
        setFormPayload(null);
        setFormError(error instanceof Error ? error.message : 'Unable to load form');
      })
      .finally(() => setLoadingForm(false));
  }, [session, dutyTypeId, sessionPath]);

  const identify = async (event: FormEvent) => {
    event.preventDefault();
    setIdentifying(true);
    setIdentifyError('');
    try {
      const data = await publicJson<IdentifyResult>(
        `/api/public/crew-form/${encodeURIComponent(token)}/identify`,
        {
          method: 'POST',
          body: JSON.stringify({ staffNumber, email }),
        },
      );
      setSession(data);
      setDutyTypeId(data.dutyTypes[0]?.id ?? '');
      setResult(null);
    } catch (error) {
      setIdentifyError(error instanceof Error ? error.message : 'Verification failed');
    } finally {
      setIdentifying(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!session || !formPayload || !dutyTypeId) return;
    const nextErrors = clientErrors(formPayload.form.schema, answers);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSubmitting(true);
    try {
      const data = await publicJson<SubmitResult>(`${sessionPath}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          dutyTypeId,
          answers,
        }),
      });
      setResult(data);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (bootError) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center gap-3 px-4 py-10">
        <h1 className="text-xl font-semibold">RMO Remote Monitoring</h1>
        <p className="text-sm text-destructive">{bootError}</p>
      </main>
    );
  }

  if (!context) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-lg items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Loading lobby form…</p>
      </main>
    );
  }

  if (result) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col gap-4 px-4 py-10">
        <Header context={context} />
        <section className="rounded-xl border bg-card p-4">
          <h2 className="text-lg font-semibold text-emerald-700">{result.message}</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Form" value={result.formName} />
            <Row label="Duty type" value={result.dutyType} />
            <Row label="Reference" value={result.reference || '—'} />
            <Row label="Submitted at" value={result.submittedAt} />
          </dl>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col gap-4 px-4 py-8">
      <Header context={context} />

      {!session ? (
        <form className="space-y-4 rounded-xl border bg-card p-4" onSubmit={identify}>
          <h2 className="text-base font-semibold">Identify crew member</h2>
          <div className="space-y-1.5">
            <Label htmlFor="staffNumber">Staff Number</Label>
            <Input
              id="staffNumber"
              autoComplete="username"
              value={staffNumber}
              onChange={event => setStaffNumber(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Registered Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              required
            />
          </div>
          {identifyError ? <p className="text-sm text-destructive">{identifyError}</p> : null}
          <Button className="h-10 w-full" disabled={identifying}>
            {identifying ? 'Verifying…' : 'Continue'}
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <section className="rounded-xl border bg-card p-4 text-sm">
            <dl className="space-y-2">
              <Row label="Crew member" value={session.crew.name} />
              <Row label="Staff number" value={session.crew.staffNumber || '—'} />
              <Row label="Crew type" value={session.crew.crewType?.name || '—'} />
            </dl>
            <div className="mt-4 space-y-1.5">
              <Label htmlFor="dutyType">Duty type</Label>
              <select
                id="dutyType"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={dutyTypeId}
                onChange={event =>
                  setDutyTypeId(event.target.value ? Number(event.target.value) : '')
                }
              >
                <option value="">Select duty type</option>
                {session.dutyTypes.map(duty => (
                  <option key={duty.id} value={duty.id}>
                    {duty.name}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="mt-3 h-8 px-0 text-xs"
              onClick={() => {
                setSession(null);
                setFormPayload(null);
                setDutyTypeId('');
              }}
            >
              Use a different identity
            </Button>
          </section>

          {loadingForm ? (
            <p className="text-sm text-muted-foreground">Loading form…</p>
          ) : null}
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

          {formPayload?.alreadySubmitted ? (
            <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
              <p className="font-medium">This form has already been submitted.</p>
              <p className="mt-1 text-muted-foreground">
                {formPayload.alreadySubmitted.formName} ·{' '}
                {formPayload.alreadySubmitted.dutyType}
              </p>
              <p className="mt-1">
                Reference: {formPayload.alreadySubmitted.reference || '—'}
              </p>
              <p className="mt-1">
                Submitted at: {formPayload.alreadySubmitted.submittedAt}
              </p>
            </section>
          ) : null}

          {formPayload && !formPayload.alreadySubmitted ? (
            <form className="space-y-4" onSubmit={submit}>
              <div>
                <h2 className="text-lg font-semibold">{formPayload.form.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {formPayload.form.questionCount} Questions
                </p>
              </div>
              <FormFields
                schema={formPayload.form.schema}
                answers={answers}
                errors={fieldErrors}
                onChange={(key, value) => {
                  setAnswers(current => {
                    const next = { ...current };
                    if (value === '') delete next[key];
                    else next[key] = value;
                    return next;
                  });
                }}
              />
              <Button className="h-11 w-full" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit Form'}
              </Button>
            </form>
          ) : null}
        </div>
      )}
    </main>
  );
}

function Header({ context }: { context: LobbyContext }) {
  return (
    <header className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        RMO Remote Monitoring
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">{context.lobbyName}</h1>
      <p className="text-sm text-muted-foreground">{context.divisionName}</p>
      <p className="pt-1 text-base font-medium">{context.title}</p>
    </header>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
