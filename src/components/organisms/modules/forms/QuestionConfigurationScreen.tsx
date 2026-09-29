'use client';

import { Button } from '@/components/ui/button';
import { apiRequest } from '@/components/organisms/modules/administration/api';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, TableSkeleton } from './form-ui';

interface Option {
  id: number;
  code: string;
  name: string;
}

interface ConfigItem {
  id: number;
  questionId: number;
  displayOrder: number;
  required: boolean;
  status: string;
  question: { id: number; code: string; text: string; type: string };
}

interface QuestionOption {
  id: number;
  code: string;
  text: string;
  status: string;
}

export function QuestionConfigurationScreen() {
  const [crewTypes, setCrewTypes] = useState<Option[]>([]);
  const [dutyTypes, setDutyTypes] = useState<Option[]>([]);
  const [questions, setQuestions] = useState<QuestionOption[]>([]);
  const [crewTypeId, setCrewTypeId] = useState('');
  const [dutyTypeId, setDutyTypeId] = useState('');
  const [items, setItems] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [addQuestionId, setAddQuestionId] = useState('');

  useEffect(() => {
    Promise.all([
      apiRequest<{ items: Option[] }>('/api/admin/crew-types?status=ACTIVE&pageSize=100'),
      apiRequest<{ items: Option[] }>('/api/admin/duty-types?status=ACTIVE&pageSize=100'),
      apiRequest<{ items: QuestionOption[] }>('/api/admin/questions?status=ACTIVE&pageSize=100'),
    ]).then(([crews, duties, qs]) => {
      setCrewTypes(crews.items);
      setDutyTypes(duties.items);
      setQuestions(qs.items);
    });
  }, []);

  const load = () => {
    if (!crewTypeId || !dutyTypeId) return;
    setLoading(true);
    apiRequest<{ items: ConfigItem[] }>(
      `/api/admin/question-configurations?crewTypeId=${crewTypeId}&dutyTypeId=${dutyTypeId}`,
    )
      .then(result => setItems(result.items))
      .catch(cause => toast.error(cause instanceof Error ? cause.message : 'Load failed'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crewTypeId, dutyTypeId]);

  const save = async (next: ConfigItem[]) => {
    try {
      const result = await apiRequest<{ items: ConfigItem[] }>(
        '/api/admin/question-configurations',
        {
          method: 'PUT',
          body: JSON.stringify({
            crewTypeId: Number(crewTypeId),
            dutyTypeId: Number(dutyTypeId),
            items: next.map((item, index) => ({
              questionId: item.questionId,
              displayOrder: index,
              required: item.required,
              status: item.status,
            })),
          }),
        },
      );
      setItems(result.items);
      toast.success('Configuration saved');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Save failed');
    }
  };

  const available = questions.filter(
    question => !items.some(item => item.questionId === question.id),
  );

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Question Configuration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose crew type and duty type, then order the questions for the one crew form.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={crewTypeId}
          onChange={event => setCrewTypeId(event.target.value)}
        >
          <option value="">Crew type</option>
          {crewTypes.map(row => (
            <option key={row.id} value={row.id}>
              {row.code} — {row.name}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={dutyTypeId}
          onChange={event => setDutyTypeId(event.target.value)}
        >
          <option value="">Duty type</option>
          {dutyTypes.map(row => (
            <option key={row.id} value={row.id}>
              {row.code} — {row.name}
            </option>
          ))}
        </select>
      </div>
      {!crewTypeId || !dutyTypeId ? (
        <EmptyState title="Select crew type and duty type" />
      ) : loading ? (
        <TableSkeleton />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <select
              className="h-9 min-w-[240px] rounded-md border bg-background px-3 text-sm"
              value={addQuestionId}
              onChange={event => setAddQuestionId(event.target.value)}
            >
              <option value="">Add question…</option>
              {available.map(row => (
                <option key={row.id} value={row.id}>
                  {row.code} — {row.text}
                </option>
              ))}
            </select>
            <Button
              className="h-9"
              disabled={!addQuestionId}
              onClick={() => {
                const question = questions.find(row => row.id === Number(addQuestionId));
                if (!question) return;
                const next = [
                  ...items,
                  {
                    id: 0,
                    questionId: question.id,
                    displayOrder: items.length,
                    required: false,
                    status: 'ACTIVE',
                    question: {
                      id: question.id,
                      code: question.code,
                      text: question.text,
                      type: 'YES_NO',
                    },
                  },
                ];
                setAddQuestionId('');
                void save(next);
              }}
            >
              Add
            </Button>
          </div>
          {items.length === 0 ? (
            <EmptyState title="No questions configured for this pair" />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Order</th>
                    <th className="px-4 py-3 font-medium">Question</th>
                    <th className="px-4 py-3 font-medium">Required</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row, index) => (
                    <tr key={`${row.questionId}-${index}`} className="border-b last:border-0">
                      <td className="px-4 py-3">{index + 1}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.question.text}</div>
                        <div className="text-xs text-muted-foreground">{row.question.code}</div>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={row.required}
                          onChange={event => {
                            const next = items.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, required: event.target.checked }
                                : item,
                            );
                            void save(next);
                          }}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            className="h-8"
                            disabled={index === 0}
                            onClick={() => {
                              const next = [...items];
                              [next[index - 1], next[index]] = [next[index], next[index - 1]];
                              void save(next);
                            }}
                          >
                            Up
                          </Button>
                          <Button
                            variant="outline"
                            className="h-8"
                            disabled={index === items.length - 1}
                            onClick={() => {
                              const next = [...items];
                              [next[index + 1], next[index]] = [next[index], next[index + 1]];
                              void save(next);
                            }}
                          >
                            Down
                          </Button>
                          <Button
                            variant="outline"
                            className="h-8"
                            onClick={() => {
                              void save(items.filter((_, itemIndex) => itemIndex !== index));
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
