'use client';

import { Button } from '@/components/ui/button';
import { apiRequest } from '@/components/organisms/modules/administration/api';
import { formatIstDisplay } from '@/lib/rmo/datetime';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState, TableSkeleton } from './form-ui';

interface DutyTypeOption {
  id: number;
  code: string;
  name: string;
}

interface CrewFormRow {
  id: number;
  name: string;
  description: string;
  questionCount?: number;
  dutyType: { id: number; code: string; name: string } | null;
  crewType: { id: number; code: string; name: string } | null;
  currentVersion: { versionNumber: number } | null;
}

interface Page<T> {
  items: T[];
  total: number;
}

interface SubmissionRow {
  id: number;
  submittedAt: string;
  formId: number;
}

export function CrewFormListScreen() {
  const user = useAuthStore(state => state.user);
  const crewType = user?.crewType;
  const [dutyTypes, setDutyTypes] = useState<DutyTypeOption[]>([]);
  const [selectedDutyId, setSelectedDutyId] = useState<number | null>(null);
  const [form, setForm] = useState<CrewFormRow | null>(null);
  const [submission, setSubmission] = useState<SubmissionRow | null>(null);
  const [loadingDutyTypes, setLoadingDutyTypes] = useState(true);
  const [loadingForm, setLoadingForm] = useState(false);
  const [error, setError] = useState('');
  const [ambiguous, setAmbiguous] = useState(false);

  useEffect(() => {
    setLoadingDutyTypes(true);
    apiRequest<DutyTypeOption[]>('/api/crew/duty-types')
      .then(items => {
        setDutyTypes(items);
        setError('');
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load duty types'))
      .finally(() => setLoadingDutyTypes(false));
  }, []);

  useEffect(() => {
    if (selectedDutyId == null) {
      setForm(null);
      setSubmission(null);
      setAmbiguous(false);
      return;
    }
    setLoadingForm(true);
    setAmbiguous(false);
    const params = new URLSearchParams({
      pageSize: '5',
      dutyTypeId: String(selectedDutyId),
    });
    apiRequest<Page<CrewFormRow>>(`/api/admin/forms?${params}`)
      .then(async result => {
        if (result.total > 1) {
          setAmbiguous(true);
          setForm(null);
          setSubmission(null);
          setError(
            'Multiple published forms match this crew type and duty type. Contact an administrator.',
          );
          return;
        }
        const next = result.items[0] ?? null;
        setForm(next);
        setError('');
        if (!next) {
          setSubmission(null);
          return;
        }
        try {
          const submissions = await apiRequest<Page<SubmissionRow>>(
            `/api/submissions?formId=${next.id}&pageSize=1`,
          );
          setSubmission(submissions.items[0] ?? null);
        } catch {
          setSubmission(null);
        }
      })
      .catch(cause => {
        setForm(null);
        setSubmission(null);
        setError(cause instanceof Error ? cause.message : 'Unable to load form');
      })
      .finally(() => setLoadingForm(false));
  }, [selectedDutyId]);

  const selectedDuty = dutyTypes.find(item => item.id === selectedDutyId) ?? null;
  const crewLabel = crewType?.name || crewType?.code || 'Not assigned';

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Crew Forms</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Select your duty type to open the one applicable form for your crew type.
        </p>
      </div>

      <section className="rounded-xl border bg-card p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Crew Type
        </p>
        <p className="mt-2 text-lg font-semibold" aria-readonly>
          {crewLabel}
        </p>
        {!crewType ? (
          <p className="mt-1 text-sm text-destructive">
            No crew type is assigned to your account. Contact an administrator.
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border bg-card p-4">
        <p className="text-sm font-medium">Select Duty Type</p>
        {loadingDutyTypes ? <TableSkeleton /> : null}
        {!loadingDutyTypes && dutyTypes.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No active duty types are available.</p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {dutyTypes.map(duty => (
            <Button
              key={duty.id}
              type="button"
              variant={selectedDutyId === duty.id ? 'default' : 'outline'}
              className="h-9"
              onClick={() => {
                setSelectedDutyId(duty.id);
                setLoadingForm(true);
                setForm(null);
                setSubmission(null);
                setError('');
                setAmbiguous(false);
              }}
            >
              {duty.name}
            </Button>
          ))}
        </div>
      </section>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {selectedDutyId != null ? (
        <section className="rounded-xl border bg-card p-4">
          <p className="text-sm font-medium">Available Form</p>
          {loadingForm ? <div className="mt-3"><TableSkeleton /></div> : null}
          {!loadingForm && !form && !ambiguous ? (
            <EmptyState
              title="No form available"
              body={`No form is currently available for ${crewLabel} — ${selectedDuty?.name || 'selected duty'}.`}
            />
          ) : null}
          {!loadingForm && form ? (
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-lg font-semibold">{form.name}</p>
                <p className="text-sm text-muted-foreground">
                  {form.dutyType?.name || selectedDuty?.name}
                  {typeof form.questionCount === 'number'
                    ? ` · ${form.questionCount} Questions`
                    : ''}
                </p>
                {submission ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Submitted:{' '}
                    {formatIstDisplay(submission.submittedAt, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                ) : null}
              </div>
              <div className="flex gap-2">
                {submission ? (
                  <Button asChild variant="outline" className="h-9">
                    <Link href={`/submissions/${submission.id}`}>View Submission</Link>
                  </Button>
                ) : null}
                <Button asChild className="h-9">
                  <Link
                    href={`/forms/${form.id}/fill?dutyTypeId=${selectedDutyId}`}
                  >
                    {submission ? 'Fill Again' : 'Start Form'}
                  </Link>
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
