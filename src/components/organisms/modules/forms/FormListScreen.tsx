'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/components/organisms/modules/administration/api';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState, StatusPill, TableSkeleton } from './form-ui';

interface FormRow {
  id: number;
  name: string;
  description: string;
  status: string;
  division: { name: string } | null;
  currentVersion: { versionNumber: number } | null;
  _count: { submissions: number };
}

interface Page<T> {
  items: T[];
  total: number;
}

export function FormListScreen() {
  const role = useAuthStore(state => state.user?.rmoRole);
  const manager = role === 'SYSTEM_ADMIN' || role === 'DIVISION_ADMIN';
  const submitter = role === 'LOBBY_USER' || role === 'CREW_USER';
  const [items, setItems] = useState<FormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [divisions, setDivisions] = useState<Array<{ id: number; name: string }>>([]);

  useEffect(() => {
    if (role !== 'SYSTEM_ADMIN') return;
    apiRequest<Page<{ id: number; name: string }>>('/api/admin/divisions?pageSize=50')
      .then(result => setDivisions(result.items))
      .catch(() => setDivisions([]));
  }, [role]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ pageSize: '50' });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (divisionId) params.set('divisionId', divisionId);
    apiRequest<Page<FormRow>>(`/api/admin/forms?${params.toString()}`)
      .then(result => {
        setItems(result.items);
        setError('');
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load forms'))
      .finally(() => setLoading(false));
  }, [search, status, divisionId]);

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Forms</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Build division forms, publish a version, and assign them to lobbies.
          </p>
        </div>
        {manager ? (
          <Button className="h-9" asChild>
            <Link href="/forms/new">New form</Link>
          </Button>
        ) : null}
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <Input aria-label="Search forms" placeholder="Search forms" value={search} onChange={event => setSearch(event.target.value)} />
        {submitter ? null : (
          <select aria-label="Status" className="h-9 rounded-md border bg-background px-3 text-sm" value={status} onChange={event => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        )}
        {role === 'SYSTEM_ADMIN' ? (
          <select aria-label="Division" className="h-9 rounded-md border bg-background px-3 text-sm" value={divisionId} onChange={event => setDivisionId(event.target.value)}>
            <option value="">All divisions</option>
            {divisions.map(division => (
              <option key={division.id} value={division.id}>{division.name}</option>
            ))}
          </select>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? <TableSkeleton /> : null}
      {!loading && items.length === 0 ? (
        <EmptyState title="No forms yet" body="Published forms assigned to a lobby appear here for the people who can submit them." />
      ) : null}
      {!loading && items.length > 0 ? (
        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Form</th>
                <th className="px-4 py-3 font-medium">Division</th>
                <th className="px-4 py-3 font-medium">Version</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Submissions</th>
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
                  <td className="px-4 py-3">{item.division?.name || 'System-wide'}</td>
                  <td className="px-4 py-3">{item.currentVersion ? `v${item.currentVersion.versionNumber}` : '—'}</td>
                  <td className="px-4 py-3"><StatusPill status={item.status} /></td>
                  <td className="px-4 py-3 tabular-nums">{item._count.submissions}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      {manager || role === 'DIVISION_MONITOR' ? (
                        <Link className="text-sm font-medium underline" href={`/forms/${item.id}`}>Open</Link>
                      ) : null}
                      {submitter && item.status === 'PUBLISHED' ? (
                        <Link className="text-sm font-medium underline" href={`/forms/${item.id}/fill`}>Submit</Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
