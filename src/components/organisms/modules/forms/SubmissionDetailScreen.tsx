'use client';

import { apiRequest } from '@/components/organisms/modules/administration/api';
import type { AnswerMap, FormSchema } from '@/types/form';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FormFields, StatusPill, TableSkeleton } from './form-ui';

interface SubmissionDetail {
  id: number;
  submittedAt: string;
  status: string;
  answers: AnswerMap;
  form: { name: string; description: string };
  formVersion: { versionNumber: number; schema: FormSchema };
  division: { name: string };
  lobby: { name: string } | null;
  submittedBy: { name: string; loginId: string | null };
}

export function SubmissionDetailScreen({ submissionId }: { submissionId: number }) {
  const [row, setRow] = useState<SubmissionDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<SubmissionDetail>(`/api/submissions/${submissionId}`)
      .then(result => {
        setRow(result);
        setError('');
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load submission'))
      .finally(() => setLoading(false));
  }, [submissionId]);

  if (loading) return <div className="px-4 lg:px-6"><TableSkeleton /></div>;
  if (error || !row) return <p className="px-4 text-sm text-destructive lg:px-6">{error || 'Submission not found'}</p>;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 lg:px-6">
      <div>
        <Link href="/submissions" className="text-xs text-muted-foreground underline">Submissions</Link>
        <div className="mt-2 flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{row.form.name}</h1>
          <StatusPill status={row.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{row.form.description}</p>
      </div>
      <dl className="grid gap-3 rounded-xl border bg-card p-4 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Form version</dt><dd>v{row.formVersion.versionNumber}</dd></div>
        <div><dt className="text-muted-foreground">Division</dt><dd>{row.division.name}</dd></div>
        <div><dt className="text-muted-foreground">Lobby</dt><dd>{row.lobby?.name || '—'}</dd></div>
        <div><dt className="text-muted-foreground">Submitted by</dt><dd>{row.submittedBy.loginId || row.submittedBy.name}</dd></div>
        <div><dt className="text-muted-foreground">Submitted at</dt><dd>{new Date(row.submittedAt).toLocaleString()}</dd></div>
      </dl>
      <FormFields schema={row.formVersion.schema} answers={row.answers || {}} readOnly />
    </div>
  );
}
