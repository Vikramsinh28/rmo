'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormFields, clientErrors } from '@/components/organisms/modules/forms/form-ui';
import { PASSWORD_CHECKS } from '@/lib/utils/password/password-policy';
import type { AnswerMap, FormSchema } from '@/types/form';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react';

interface Place {
  id: number;
  name: string;
  zoneId?: number;
  divisionId?: number;
}

interface Catalog {
  zones: Place[];
  divisions: Place[];
  lobbies: Place[];
  form: { name: string; description: string; schema: FormSchema } | null;
}

interface SuccessState {
  applicationId: string;
  status: string;
  requestedDivision: string;
  requestedLobby: string;
  message: string;
}

const STEPS = ['Personal', 'Work', 'Location', 'Questions', 'Login', 'Review'] as const;

const fieldClass =
  'h-11 rounded-xl border-white/10 bg-white/5 px-3 text-sm text-zinc-50 md:text-sm placeholder:text-zinc-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-50';

async function readError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.message || 'Could not submit the enrollment.';
}

export function EnrollScreen() {
  const [step, setStep] = useState(0);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [staffNumber, setStaffNumber] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [lobbyId, setLobbyId] = useState('');
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    fetch('/api/enrollment/options')
      .then(async response => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json();
      })
      .then(body => setCatalog(body.data))
      .catch(cause => setLoadError(cause instanceof Error ? cause.message : 'Unable to load enrollment'));
  }, []);

  const divisions = useMemo(
    () => (catalog?.divisions || []).filter(item => !zoneId || item.zoneId === Number(zoneId)),
    [catalog, zoneId],
  );
  const lobbies = useMemo(
    () => (catalog?.lobbies || []).filter(item => !divisionId || item.divisionId === Number(divisionId)),
    [catalog, divisionId],
  );
  const zoneName = catalog?.zones.find(item => item.id === Number(zoneId))?.name || '';
  const divisionName = catalog?.divisions.find(item => item.id === Number(divisionId))?.name || '';
  const lobbyName = catalog?.lobbies.find(item => item.id === Number(lobbyId))?.name || '';

  const stepError = (): string => {
    if (step === 0) {
      if (!fullName.trim() || !email.trim() || !phone.trim() || !employeeId.trim()) {
        return 'Fill in your name, email, phone, and employee ID.';
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email.';
    }
    if (step === 1 && !staffNumber.trim()) return 'Enter your employee or staff number.';
    if (step === 2 && (!zoneId || !divisionId || !lobbyId)) {
      return 'Choose the zone, division, and lobby you are requesting.';
    }
    if (step === 3 && catalog?.form) {
      const next = clientErrors(catalog.form.schema, answers);
      if (next.form) return next.form;
    }
    if (step === 4) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(loginId.trim())) {
        return 'Login ID must be 3 to 80 letters, numbers, dots, hyphens, or underscores.';
      }
      const failed = PASSWORD_CHECKS.filter(check => !check.test(password));
      if (failed.length > 0) return failed[0].message;
      if (password !== confirmPassword) return 'Password confirmation does not match.';
    }
    return '';
  };

  const next = () => {
    const message = stepError();
    setError(message);
    if (!message) setStep(current => Math.min(current + 1, STEPS.length - 1));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const message = stepError();
    setError(message);
    if (message) return;
    setPending(true);
    try {
      const response = await fetch('/api/enrollment/crew', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName,
          email,
          phone,
          employeeId,
          staffNumber,
          zoneId: Number(zoneId),
          divisionId: Number(divisionId),
          lobbyId: Number(lobbyId),
          answers,
          loginId,
          password,
          confirmPassword,
        }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const body = await response.json();
      setPassword('');
      setConfirmPassword('');
      setSuccess(body.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit the enrollment.');
    } finally {
      setPending(false);
    }
  };

  if (success) {
    return (
      <Shell>
        <p className="text-xs font-medium tracking-[0.22em] text-orange-200/80">CREW ENROLLMENT</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Enrollment submitted</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-300">{success.message}</p>
        <dl className="mt-6 space-y-3 text-sm">
          <Row label="Application ID" value={success.applicationId} />
          <Row label="Status" value="Pending approval" />
          <Row label="Requested division" value={success.requestedDivision} />
          <Row label="Requested lobby" value={success.requestedLobby} />
        </dl>
        <p className="mt-6 text-sm text-zinc-400">
          After approval, sign in with the login ID and password you created. Forgot that password later?
          Use the existing forgot-password link after your account is active.
        </p>
        <Link href="/login" className="mt-6 inline-flex text-sm font-medium text-orange-200 underline">
          Back to sign in
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-xs font-medium tracking-[0.22em] text-orange-200/80">JOIN RMO</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Crew enrollment</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Request a crew account. A division admin approves it before you can sign in. The division and lobby
        you choose are a request, not access.
      </p>
      <ol className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={`rounded-full px-2 py-1 text-center text-[11px] ${index === step ? 'bg-orange-500 text-zinc-950' : 'bg-white/5 text-zinc-400'}`}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>
      {loadError ? <p className="mt-4 text-sm text-red-300">{loadError}</p> : null}
      <form className="mt-6 space-y-4" onSubmit={submit}>
        {step === 0 ? (
          <Section title="Personal information">
            <Field id="full-name" label="Full name" value={fullName} onChange={setFullName} />
            <Field id="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
            <Field id="phone" label="Phone" value={phone} onChange={setPhone} autoComplete="tel" />
            <Field id="employee-id" label="Employee ID" value={employeeId} onChange={setEmployeeId} />
          </Section>
        ) : null}
        {step === 1 ? (
          <Section title="Employment information">
            <Field id="staff-number" label="Employee / staff number" value={staffNumber} onChange={setStaffNumber} />
          </Section>
        ) : null}
        {step === 2 ? (
          <Section title="Requested location">
            <SelectField id="zone" label="Zone" value={zoneId} onChange={value => { setZoneId(value); setDivisionId(''); setLobbyId(''); }}>
              <option value="">Select zone</option>
              {catalog?.zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
            </SelectField>
            <SelectField id="division" label="Division" value={divisionId} onChange={value => { setDivisionId(value); setLobbyId(''); }}>
              <option value="">Select division</option>
              {divisions.map(division => <option key={division.id} value={division.id}>{division.name}</option>)}
            </SelectField>
            <SelectField id="lobby" label="Lobby" value={lobbyId} onChange={setLobbyId}>
              <option value="">Select lobby</option>
              {lobbies.map(lobby => <option key={lobby.id} value={lobby.id}>{lobby.name}</option>)}
            </SelectField>
          </Section>
        ) : null}
        {step === 3 ? (
          <Section title="Enrollment form">
            {catalog?.form ? (
              <div className="text-zinc-100">
                <FormFields
                  schema={catalog.form.schema}
                  answers={answers}
                  onChange={(key, value) => {
                    setAnswers(current => {
                      const next = { ...current };
                      if (value === '') delete next[key];
                      else next[key] = value;
                      return next;
                    });
                  }}
                />
              </div>
            ) : (
              <p className="text-sm text-zinc-400">No extra enrollment questions are published.</p>
            )}
          </Section>
        ) : null}
        {step === 4 ? (
          <Section title="Login credentials">
            <Field id="login-id" label="Login ID" value={loginId} onChange={setLoginId} autoComplete="username" />
            <div className="space-y-2">
              <Label htmlFor="password" className="text-zinc-300">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  className={`${fieldClass} pr-11`}
                />
                <button
                  type="button"
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-zinc-400"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(current => !current)}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <ul className="grid grid-cols-2 gap-1 text-xs text-zinc-400">
                {PASSWORD_CHECKS.map(check => (
                  <li key={check.id} className={check.test(password) ? 'text-emerald-300' : ''}>
                    {check.test(password) ? '✓' : '•'} {check.label}
                  </li>
                ))}
              </ul>
            </div>
            <Field
              id="confirm-password"
              label="Confirm password"
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
            />
          </Section>
        ) : null}
        {step === 5 ? (
          <Section title="Review and submit">
            <dl className="space-y-2 text-sm">
              <Row label="Name" value={fullName} />
              <Row label="Email" value={email} />
              <Row label="Phone" value={phone} />
              <Row label="Employee ID" value={employeeId} />
              <Row label="Staff number" value={staffNumber} />
              <Row label="Requested zone" value={zoneName} />
              <Row label="Requested division" value={divisionName} />
              <Row label="Requested lobby" value={lobbyName} />
              <Row label="Login ID" value={loginId} />
              <Row label="Password" value="Chosen by you. It is not shown again." />
            </dl>
          </Section>
        ) : null}
        {error ? <p className="text-sm text-red-300" role="alert">{error}</p> : null}
        <div className="flex gap-2">
          {step > 0 ? (
            <Button type="button" variant="outline" className="h-11 px-4 text-sm" onClick={() => { setError(''); setStep(current => current - 1); }}>
              Back
            </Button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <Button type="button" className="h-11 bg-orange-500 px-4 text-sm text-zinc-950 hover:bg-orange-400" onClick={next}>
              Continue
            </Button>
          ) : (
            <Button type="submit" className="h-11 bg-orange-500 px-4 text-sm text-zinc-950 hover:bg-orange-400" disabled={pending}>
              {pending ? 'Submitting…' : 'Submit enrollment'}
            </Button>
          )}
        </div>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-50">
      <div className="mx-auto w-full max-w-2xl rounded-3xl border border-white/10 bg-zinc-950/80 p-6 shadow-2xl sm:p-8">
        <img src="/logos/rmo-logo.png" alt="RMO" className="mb-6 h-10 w-auto object-contain" />
        {children}
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium text-zinc-200">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-zinc-300">{label}</Label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={event => onChange(event.target.value)}
        className={fieldClass}
      />
    </div>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-zinc-300">{label}</Label>
      <select id={id} className={`${fieldClass} w-full`} value={value} onChange={event => onChange(event.target.value)}>
        {children}
      </select>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/10 py-2">
      <dt className="text-zinc-400">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
