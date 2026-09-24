'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useEffect, useState } from 'react';
import { apiRequest } from './api';

interface AuditRow {
  id: number;
  action: string;
  targetType: string;
  targetId: string | null;
  createdAt: string;
  metadata: unknown;
  actor: { name: string; loginId: string | null; email: string } | null;
}

interface Page {
  items: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

export function AuditScreen() {
  const [page, setPage] = useState<Page | null>(null);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState('');

  const load = () => {
    const params = new URLSearchParams({ page: String(currentPage), pageSize: '20' });
    if (search) params.set('search', search);
    apiRequest<Page>(`/api/admin/audit-logs?${params.toString()}`)
      .then(setPage)
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load'));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit logs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Administrative changes recorded by this console. Passwords are never stored here.
        </p>
      </div>
      <div className="flex gap-2">
        <Input aria-label="Search audit logs" placeholder="Search action" value={search} onChange={event => setSearch(event.target.value)} />
        <Button variant="outline" className="h-9" onClick={() => { setCurrentPage(1); load(); }}>Search</Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="overflow-x-auto rounded-xl border bg-card">
        {!page ? (
          <p className="px-4 py-8 text-sm text-muted-foreground">Loading audit logs…</p>
        ) : page.items.length === 0 ? (
          <p className="px-4 py-10 text-sm text-muted-foreground">
            No audit events yet. Organization and user changes will be listed here.
          </p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Target</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map(row => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-4 py-3 text-xs">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">{row.actor?.name || 'Unknown'}</td>
                  <td className="px-4 py-3">{row.action}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {row.targetType} {row.targetId || ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function RoleScreen() {
  const [roles, setRoles] = useState<Array<{ role: string; scope: string; description: string }>>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest<Array<{ role: string; scope: string; description: string }>>('/api/admin/roles')
      .then(setRoles)
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load'));
  }, []);

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          These six roles are fixed. Assign them from Users.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {roles.map(role => (
          <article key={role.role} className="rounded-xl border bg-card p-4">
            <p className="font-medium">{role.role}</p>
            <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{role.scope}</p>
            <p className="mt-2 text-sm text-muted-foreground">{role.description}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
