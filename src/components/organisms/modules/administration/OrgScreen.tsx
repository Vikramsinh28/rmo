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
import { Skeleton } from '@/components/ui/skeleton';
import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest, StatusBadge } from './api';

type Kind = 'zones' | 'divisions' | 'lobbies';

interface Row {
  id: number;
  name: string;
  code: string;
  status: string;
  zoneId?: number;
  divisionId?: number;
  zone?: { id: number; name: string; code: string };
  division?: { id: number; name: string; code: string; zone?: { name: string } };
}

interface Page {
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
}

const TITLES: Record<Kind, string> = {
  zones: 'Zones',
  divisions: 'Divisions',
  lobbies: 'Lobbies',
};

export function OrgScreen({ kind, canWrite }: { kind: Kind; canWrite: boolean }) {
  const [page, setPage] = useState<Page | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [parents, setParents] = useState<Row[]>([]);
  const [form, setForm] = useState({ name: '', code: '', parentId: '' });

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(currentPage), pageSize: '10' });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    apiRequest<Page>(`/api/admin/${kind}?${params.toString()}`)
      .then(setPage)
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, currentPage, status]);

  useEffect(() => {
    if (kind === 'zones') return;
    const parent = kind === 'divisions' ? 'zones' : 'divisions';
    apiRequest<Page>(`/api/admin/${parent}?pageSize=50`)
      .then(result => setParents(result.items))
      .catch(() => setParents([]));
  }, [kind]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', code: '', parentId: parents[0] ? String(parents[0].id) : '' });
    setOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    setForm({
      name: row.name,
      code: row.code,
      parentId: String(row.zoneId || row.divisionId || ''),
    });
    setOpen(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const payload: Record<string, string | number> = {
      name: form.name,
      code: form.code,
    };
    if (kind === 'divisions') payload.zoneId = Number(form.parentId);
    if (kind === 'lobbies') payload.divisionId = Number(form.parentId);
    try {
      if (editing) {
        await apiRequest(`/api/admin/${kind}/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        toast.success('Saved');
      } else {
        await apiRequest(`/api/admin/${kind}`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success('Created');
      }
      setOpen(false);
      load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Save failed');
    }
  };

  const toggle = async (row: Row) => {
    const next = row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    try {
      await apiRequest(`/api/admin/${kind}/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      toast.success(next === 'DISABLED' ? 'Disabled' : 'Enabled');
      load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Update failed');
    }
  };

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{TITLES[kind]}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {kind === 'zones'
              ? 'Top of the organization hierarchy.'
              : kind === 'divisions'
                ? 'Each division belongs to one zone.'
                : 'Each lobby belongs to one division.'}
          </p>
        </div>
        {canWrite ? (
          <Button className="h-9 px-3 text-sm" onClick={openCreate}>
            Create {TITLES[kind].slice(0, -1).toLowerCase()}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Search"
          placeholder="Search name or code"
          value={search}
          onChange={event => setSearch(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              setCurrentPage(1);
              load();
            }
          }}
        />
        <select
          aria-label="Status"
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={status}
          onChange={event => {
            setStatus(event.target.value);
            setCurrentPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
        </select>
        <Button
          variant="outline"
          className="h-9"
          onClick={() => {
            setCurrentPage(1);
            load();
          }}
        >
          Search
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="overflow-hidden rounded-xl border bg-card">
        {loading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : page && page.items.length === 0 ? (
          <p className="px-4 py-10 text-sm text-muted-foreground">No records match this view.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Code</th>
                  {kind !== 'zones' ? <th className="px-4 py-3 font-medium">Parent</th> : null}
                  <th className="px-4 py-3 font-medium">Status</th>
                  {canWrite ? <th className="px-4 py-3 font-medium">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {page?.items.map(row => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-4 py-3">{row.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{row.code}</td>
                    {kind !== 'zones' ? (
                      <td className="px-4 py-3">
                        {row.zone?.name || row.division?.name || '—'}
                      </td>
                    ) : null}
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    {canWrite ? (
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Button variant="outline" className="h-8" onClick={() => openEdit(row)}>
                            Edit
                          </Button>
                          <Button variant="outline" className="h-8" onClick={() => toggle(row)}>
                            {row.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{page ? `${page.total} records` : ''}</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="h-8"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage(value => value - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            className="h-8"
            disabled={!page || currentPage * page.pageSize >= page.total}
            onClick={() => setCurrentPage(value => value + 1)}
          >
            Next
          </Button>
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit' : 'Create'} {TITLES[kind].slice(0, -1).toLowerCase()}</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={save}>
            {kind !== 'zones' ? (
              <div className="space-y-2">
                <Label>{kind === 'divisions' ? 'Zone' : 'Division'}</Label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={form.parentId}
                  onChange={event => setForm(current => ({ ...current, parentId: event.target.value }))}
                  required
                >
                  <option value="">Select</option>
                  {parents.map(parent => (
                    <option key={parent.id} value={parent.id}>
                      {parent.name} ({parent.code})
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="org-name">Name</Label>
              <Input
                id="org-name"
                value={form.name}
                onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-code">Code</Label>
              <Input
                id="org-code"
                value={form.code}
                onChange={event => setForm(current => ({ ...current, code: event.target.value }))}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" className="h-9">
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
