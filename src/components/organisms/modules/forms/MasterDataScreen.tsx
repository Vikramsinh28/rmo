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
import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, StatusPill, TableSkeleton } from '@/components/organisms/modules/forms/form-ui';

interface MasterRow {
  id: number;
  code: string;
  name: string;
  description: string;
  status: string;
}

export function MasterDataScreen({
  kind,
  title,
  apiPath,
}: {
  kind: string;
  title: string;
  apiPath: string;
}) {
  const [items, setItems] = useState<MasterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MasterRow | null>(null);
  const [form, setForm] = useState({ code: '', name: '', description: '', status: 'ACTIVE' });

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ pageSize: '100' });
    if (search) params.set('search', search);
    apiRequest<{ items: MasterRow[] }>(`${apiPath}?${params.toString()}`)
      .then(result => {
        setItems(result.items);
        setError('');
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, apiPath]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      if (editing) {
        await apiRequest(`${apiPath}/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(form),
        });
        toast.success(`${title} updated`);
      } else {
        await apiRequest(apiPath, {
          method: 'POST',
          body: JSON.stringify(form),
        });
        toast.success(`${title} created`);
      }
      setOpen(false);
      load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Save failed');
    }
  };

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dynamic master data for crew registration. Codes are stable identifiers.
          </p>
        </div>
        <Button
          className="h-9 text-sm"
          onClick={() => {
            setEditing(null);
            setForm({ code: '', name: '', description: '', status: 'ACTIVE' });
            setOpen(true);
          }}
        >
          Create {kind}
        </Button>
      </div>
      <Input
        placeholder="Search code or name"
        value={search}
        onChange={event => setSearch(event.target.value)}
        className="max-w-sm"
      />
      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : items.length === 0 ? (
        <EmptyState title={`No ${title.toLowerCase()} yet`} />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(row => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{row.code}</td>
                  <td className="px-4 py-3">{row.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.description || '—'}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="h-8"
                        onClick={() => {
                          setEditing(row);
                          setForm({
                            code: row.code,
                            name: row.name,
                            description: row.description,
                            status: row.status,
                          });
                          setOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        className="h-8"
                        onClick={async () => {
                          try {
                            await apiRequest(`${apiPath}/${row.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({
                                status: row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                              }),
                            });
                            toast.success(
                              row.status === 'ACTIVE' ? 'Disabled' : 'Enabled',
                            );
                            load();
                          } catch (cause) {
                            toast.error(
                              cause instanceof Error ? cause.message : 'Update failed',
                            );
                          }
                        }}
                      >
                        {row.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                      </Button>
                    </div>
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
            <DialogTitle>
              {editing ? `Edit ${kind}` : `Create ${kind}`}
            </DialogTitle>
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
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={form.description}
                onChange={event =>
                  setForm(current => ({ ...current, description: event.target.value }))
                }
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
