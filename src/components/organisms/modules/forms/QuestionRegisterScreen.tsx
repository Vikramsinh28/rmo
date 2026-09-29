'use client';

import { Button } from '@/components/ui/button';
import { apiRequest } from '@/components/organisms/modules/administration/api';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, TableSkeleton } from './form-ui';

interface RegisterOption {
  id: number;
  code: string;
  name: string;
}

interface QuestionRow {
  id: number;
  code: string;
  text: string;
  registers: Array<{ registerTypeId: number; registerType: RegisterOption }>;
}

export function QuestionRegisterScreen() {
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [registers, setRegisters] = useState<RegisterOption[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedRegisters, setSelectedRegisters] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([
      apiRequest<{ items: QuestionRow[] }>('/api/admin/questions?pageSize=100'),
      apiRequest<{ items: RegisterOption[] }>('/api/admin/register-types?status=ACTIVE&pageSize=100'),
    ])
      .then(([qs, regs]) => {
        setQuestions(qs.items);
        setRegisters(regs.items);
        if (selectedId) {
          const current = qs.items.find(row => row.id === selectedId);
          setSelectedRegisters(current?.registers.map(row => row.registerTypeId) || []);
        }
      })
      .catch(cause => toast.error(cause instanceof Error ? cause.message : 'Load failed'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = questions.find(row => row.id === selectedId) || null;

  const save = async () => {
    if (!selected) return;
    try {
      await apiRequest(`/api/admin/questions/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ registerTypeIds: selectedRegisters }),
      });
      toast.success('Register mapping saved');
      load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Save failed');
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
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Question → Register Mapping</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Registers are reporting metadata. A question can belong to multiple registers.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border">
          <div className="border-b px-4 py-3 text-sm font-medium">Questions</div>
          {questions.length === 0 ? (
            <div className="p-4">
              <EmptyState title="No questions" />
            </div>
          ) : (
            <ul className="max-h-[480px] overflow-y-auto text-sm">
              {questions.map(row => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={`w-full px-4 py-3 text-left hover:bg-muted/40 ${
                      selectedId === row.id ? 'bg-muted/60' : ''
                    }`}
                    onClick={() => {
                      setSelectedId(row.id);
                      setSelectedRegisters(row.registers.map(item => item.registerTypeId));
                    }}
                  >
                    <div className="font-medium">{row.text}</div>
                    <div className="text-xs text-muted-foreground">{row.code}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border p-4">
          {!selected ? (
            <EmptyState title="Select a question" />
          ) : (
            <div className="space-y-4">
              <div>
                <h2 className="font-medium">{selected.text}</h2>
                <p className="text-xs text-muted-foreground">{selected.code}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Mapped Registers</p>
                {registers.map(row => (
                  <label key={row.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedRegisters.includes(row.id)}
                      onChange={event => {
                        setSelectedRegisters(current =>
                          event.target.checked
                            ? [...current, row.id]
                            : current.filter(id => id !== row.id),
                        );
                      }}
                    />
                    {row.code} — {row.name}
                  </label>
                ))}
              </div>
              <Button className="h-9" onClick={save}>
                Save
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
