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
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, StatusPill, TableSkeleton } from './form-ui';

interface RegisterRow {
  id: number;
  name: string;
  description: string;
  status: string;
  formId: number;
  division: { name: string };
  form: { name: string };
}

interface Option {
  id: number;
  name: string;
}

export function RegisterScreen() {
  const role = useAuthStore(state => state.user?.rmoRole);
  const canEdit = role === 'SYSTEM_ADMIN' || role === 'DIVISION_ADMIN';
  const [items, setItems] = useState<RegisterRow[]>([]);
  const [forms, setForms] = useState<Option[]>([]);
  const [divisions, setDivisions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RegisterRow | null>(null);
  const [form, setForm] = useState({ name: '', description: '', formId: '', divisionId: '' });

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ pageSize: '50' });
    if (search) params.set('search', search);
    if (divisionId) params.set('divisionId', divisionId);
    apiRequest<{ items: RegisterRow[] }>(`/api/admin/registers?${params.toString()}`)
      .then(result => {
        setItems(result.items);
        setError('');
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load registers'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, divisionId]);

  useEffect(() => {
    apiRequest<{ items: Option[] }>('/api/admin/forms?pageSize=50')
      .then(result => setForms(result.items))
      .catch(() => setForms([]));
    if (role === 'SYSTEM_ADMIN') {
      apiRequest<{ items: Option[] }>('/api/admin/divisions?pageSize=50')
        .then(result => setDivisions(result.items))
        .catch(() => setDivisions([]));
    }
  }, [role]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      name: form.name,
      description: form.description,
      formId: Number(form.formId),
      ...(role === 'SYSTEM_ADMIN' && !editing ? { divisionId: Number(form.divisionId) } : {}),
    };
    try {
      if (editing) {
        await apiRequest(`/api/admin/registers/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        toast.success('Register updated');
      } else {
        await apiRequest('/api/admin/registers', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success('Register created');
      }
      setOpen(false);
      load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Save failed');
    }
  };

  const setStatus = async (row: RegisterRow, status: 'ACTIVE' | 'INACTIVE') => {
    try {
      await apiRequest(`/api/admin/registers/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      toast.success(status === 'ACTIVE' ? 'Register enabled' : 'Register disabled');
      load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Update failed');
    }
  };

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Registers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A register is a division view over the submissions of one form.
          </p>
        </div>
        {canEdit ? (
          <Button
            className="h-9"
            onClick={() => {
              setEditing(null);
              setForm({ name: '', description: '', formId: '', divisionId: '' });
              setOpen(true);
            }}
          >
            New register
          </Button>
        ) : null}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <Input aria-label="Search registers" placeholder="Search registers" value={search} onChange={event => setSearch(event.target.value)} />
        {role === 'SYSTEM_ADMIN' ? (
          <select aria-label="Division" className="h-9 rounded-md border bg-background px-3 text-sm" value={divisionId} onChange={event => setDivisionId(event.target.value)}>
            <option value="">All divisions</option>
            {divisions.map(division => <option key={division.id} value={division.id}>{division.name}</option>)}
          </select>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? <TableSkeleton /> : null}
      {!loading && items.length === 0 ? (
        <EmptyState title="No registers" body="Create a register to follow submissions for a form in this division." />
      ) : null}
      {!loading && items.length > 0 ? (
        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Register</th>
                <th className="px-4 py-3 font-medium">Form</th>
                <th className="px-4 py-3 font-medium">Division</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </td>
                  <td className="px-4 py-3">{item.form.name}</td>
                  <td className="px-4 py-3">{item.division.name}</td>
                  <td className="px-4 py-3"><StatusPill status={item.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-3">
                      <Link className="font-medium underline" href={`/submissions?registerId=${item.id}`}>Submissions</Link>
                      {canEdit ? (
                        <button type="button" className="underline" onClick={() => setStatus(item, item.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')}>
                          {item.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit register' : 'New register'}</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={save}>
            <div>
              <Label htmlFor="register-name">Name</Label>
              <Input id="register-name" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} />
            </div>
            <div>
              <Label htmlFor="register-description">Description</Label>
              <Input id="register-description" value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} />
            </div>
            {role === 'SYSTEM_ADMIN' && !editing ? (
              <div>
                <Label htmlFor="register-division">Division</Label>
                <select id="register-division" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.divisionId} onChange={event => setForm(current => ({ ...current, divisionId: event.target.value }))}>
                  <option value="">Select division</option>
                  {divisions.map(division => <option key={division.id} value={division.id}>{division.name}</option>)}
                </select>
              </div>
            ) : null}
            <div>
              <Label htmlFor="register-form">Form</Label>
              <select id="register-form" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.formId} onChange={event => setForm(current => ({ ...current, formId: event.target.value }))}>
                <option value="">Select form</option>
                {forms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
            <DialogFooter>
              <Button type="submit" className="h-9">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
