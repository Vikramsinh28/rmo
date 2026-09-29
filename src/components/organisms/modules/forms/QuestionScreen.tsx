'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiRequest } from '@/components/organisms/modules/administration/api';
import { FIELD_TYPES } from '@/types/form';
import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, StatusPill, TableSkeleton } from './form-ui';

interface QuestionRow {
  id: number;
  code: string;
  text: string;
  type: string;
  required: boolean;
  helpText: string;
  status: string;
  registers: Array<{ registerType: { id: number; code: string; name: string } }>;
}

export function QuestionScreen() {
  const [items, setItems] = useState<QuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<QuestionRow | null>(null);
  const [form, setForm] = useState({
    code: '',
    text: '',
    type: 'YES_NO',
    required: false,
    helpText: '',
  });

  const load = () => {
    setLoading(true);
    apiRequest<{ items: QuestionRow[] }>('/api/admin/questions?pageSize=100')
      .then(result => {
        setItems(result.items);
        setError('');
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      if (editing) {
        await apiRequest(`/api/admin/questions/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(form),
        });
        toast.success('Question updated');
      } else {
        await apiRequest('/api/admin/questions', {
          method: 'POST',
          body: JSON.stringify(form),
        });
        toast.success('Question created');
      }
      setOpen(false);
      load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Save failed');
    }
  };

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Questions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Shared question bank. Map questions to registers separately.
          </p>
        </div>
        <Button
          className="h-9"
          onClick={() => {
            setEditing(null);
            setForm({ code: '', text: '', type: 'YES_NO', required: false, helpText: '' });
            setOpen(true);
          }}
        >
          Create question
        </Button>
      </div>
      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : items.length === 0 ? (
        <EmptyState title="No questions yet" />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Question</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Registers</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(row => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{row.code}</td>
                  <td className="px-4 py-3">{row.text}</td>
                  <td className="px-4 py-3">{row.type}</td>
                  <td className="px-4 py-3 text-xs">
                    {row.registers.map(item => item.registerType.code).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="outline"
                      className="h-8"
                      onClick={() => {
                        setEditing(row);
                        setForm({
                          code: row.code,
                          text: row.text,
                          type: row.type,
                          required: row.required,
                          helpText: row.helpText,
                        });
                        setOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit question' : 'Create question'}</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={save}>
            <div className="space-y-2">
              <Label>Code</Label>
              <Input
                value={form.code}
                onChange={event => setForm(current => ({ ...current, code: event.target.value }))}
                required
                disabled={Boolean(editing)}
              />
            </div>
            <div className="space-y-2">
              <Label>Text</Label>
              <Input
                value={form.text}
                onChange={event => setForm(current => ({ ...current, text: event.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={form.type}
                onChange={event => setForm(current => ({ ...current, type: event.target.value }))}
              >
                {FIELD_TYPES.map(type => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.required}
                onChange={event =>
                  setForm(current => ({ ...current, required: event.target.checked }))
                }
              />
              Required by default
            </label>
            <div className="space-y-2">
              <Label>Help text</Label>
              <Input
                value={form.helpText}
                onChange={event =>
                  setForm(current => ({ ...current, helpText: event.target.value }))
                }
              />
            </div>
            <DialogFooter>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
