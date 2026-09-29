'use client';

import { apiRequest } from '@/components/organisms/modules/administration/api';
import type { AnswerMap, FormSchema } from '@/types/form';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { FormFields, StatusPill, TableSkeleton } from './form-ui';

interface AnswerRow {
  questionId: number;
  answer: unknown;
  question: {
    id: number;
    code: string;
    text: string;
    type: string;
    registers: Array<{ registerTypeId: number; registerType: { id: number; code: string; name: string } }>;
  };
}

interface SubmissionDetail {
  id: number;
  submittedAt: string;
  status: string;
  answers: AnswerMap;
  crewTypeName: string | null;
  dutyTypeName: string | null;
  form: { name: string; description: string; purpose?: string };
  formVersion: { versionNumber: number; schema: FormSchema };
  division: { name: string };
  lobby: { name: string } | null;
  submittedBy: { name: string; loginId: string | null };
  answerRows?: AnswerRow[];
}

export function SubmissionDetailScreen({ submissionId }: { submissionId: number }) {
  const [row, setRow] = useState<SubmissionDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [registerTypeId, setRegisterTypeId] = useState('');

  useEffect(() => {
    const params = registerTypeId ? `?registerTypeId=${registerTypeId}` : '';
    setLoading(true);
    apiRequest<SubmissionDetail>(`/api/submissions/${submissionId}${params}`)
      .then(result => {
        setRow(result);
        setError('');
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load submission'))
      .finally(() => setLoading(false));
  }, [submissionId, registerTypeId]);

  const registerOptions = useMemo(() => {
    const map = new Map<number, { id: number; code: string; name: string }>();
    for (const answer of row?.answerRows || []) {
      for (const reg of answer.question.registers) {
        map.set(reg.registerTypeId, reg.registerType);
      }
    }
    return [...map.values()];
  }, [row]);

  if (loading && !row) return <div className="px-4 lg:px-6"><TableSkeleton /></div>;
  if (error || !row) return <p className="px-4 text-sm text-destructive lg:px-6">{error || 'Submission not found'}</p>;

  const schemaFromAnswers: FormSchema | null =
    row.answerRows && row.answerRows.length
      ? {
          sections: ['Questions'],
          fields: row.answerRows.map((answer, index) => ({
            id: String(answer.questionId),
            key: answer.question.code,
            label: answer.question.text,
            type: answer.question.type as FormSchema['fields'][number]['type'],
            required: false,
            placeholder: '',
            helpText: '',
            options: [],
            validation: {},
            displayOrder: index,
            section: 'Questions',
          })),
        }
      : null;

  const answersFromRows: AnswerMap =
    row.answerRows && row.answerRows.length
      ? Object.fromEntries(
          row.answerRows.map(answer => [
            answer.question.code,
            answer.answer as AnswerMap[string],
          ]),
        )
      : row.answers || {};

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
        <div><dt className="text-muted-foreground">Crew</dt><dd>{row.submittedBy.name}</dd></div>
        <div><dt className="text-muted-foreground">Crew Type</dt><dd>{row.crewTypeName || '—'}</dd></div>
        <div><dt className="text-muted-foreground">Duty</dt><dd>{row.dutyTypeName || '—'}</dd></div>
        <div><dt className="text-muted-foreground">Division</dt><dd>{row.division.name}</dd></div>
        <div><dt className="text-muted-foreground">Lobby</dt><dd>{row.lobby?.name || '—'}</dd></div>
        <div><dt className="text-muted-foreground">Submitted at</dt><dd>{new Date(row.submittedAt).toLocaleString()}</dd></div>
      </dl>
      {registerOptions.length > 0 ? (
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="view-register">View by Register</label>
          <select
            id="view-register"
            className="h-9 w-full max-w-sm rounded-md border bg-background px-3 text-sm"
            value={registerTypeId}
            onChange={event => setRegisterTypeId(event.target.value)}
          >
            <option value="">All Registers</option>
            {registerOptions.map(option => (
              <option key={option.id} value={option.id}>
                {option.code} — {option.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <FormFields
        schema={schemaFromAnswers || row.formVersion.schema}
        answers={answersFromRows}
        readOnly
      />
    </div>
  );
}
