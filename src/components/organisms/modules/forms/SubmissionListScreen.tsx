'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/components/organisms/modules/administration/api';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, StatusPill, TableSkeleton } from './form-ui';

interface SubmissionRow {
  id: number;
  status: string;
  submittedAt: string;
  form: { name: string };
  lobby: { name: string } | null;
  submittedBy: { name: string; loginId: string | null };
}

interface Option {
  id: number;
  name: string;
}

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function SubmissionListScreen() {
  const role = useAuthStore(state => state.user?.rmoRole);
  const params = useSearchParams();
  const canExport = role === 'SYSTEM_ADMIN' || role === 'DIVISION_ADMIN';
  const [items, setItems] = useState<SubmissionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forms, setForms] = useState<Option[]>([]);
  const [registers, setRegisters] = useState<Option[]>([]);
  const [lobbies, setLobbies] = useState<Option[]>([]);
  const [users, setUsers] = useState<Option[]>([]);
  const [divisions, setDivisions] = useState<Option[]>([]);
  const [filters, setFilters] = useState({
    search: '',
    formId: '',
    registerId: params.get('registerId') || '',
    lobbyId: '',
    userId: '',
    divisionId: '',
    status: '',
    dateFrom: isoDaysAgo(29),
    dateTo: new Date().toISOString().slice(0, 10),
  });

  const query = useMemo(() => {
    const search = new URLSearchParams({ page: String(page), pageSize: '20' });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) search.set(key, value);
    });
    return search.toString();
  }, [filters, page]);

  useEffect(() => {
    setLoading(true);
    apiRequest<{ items: SubmissionRow[]; total: number }>(`/api/submissions?${query}`)
      .then(result => {
        setItems(result.items);
        setTotal(result.total);
        setError('');
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load submissions'))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    const load = async () => {
      const [formPage, lobbyPage] = await Promise.all([
        apiRequest<{ items: Option[] }>('/api/admin/forms?pageSize=50').catch(() => ({ items: [] })),
        apiRequest<{ items: Option[] }>('/api/admin/lobbies?pageSize=50').catch(() => ({ items: [] })),
      ]);
      setForms(formPage.items);
      setLobbies(lobbyPage.items);
      if (role === 'SYSTEM_ADMIN' || role === 'DIVISION_ADMIN' || role === 'DIVISION_MONITOR') {
        const registerPage = await apiRequest<{ items: Option[] }>('/api/admin/registers?pageSize=50').catch(() => ({ items: [] }));
        setRegisters(registerPage.items);
      }
      if (role === 'SYSTEM_ADMIN' || role === 'DIVISION_ADMIN') {
        const userPage = await apiRequest<{ items: Array<{ id: number; name: string }> }>('/api/admin/users?pageSize=50').catch(() => ({ items: [] }));
        setUsers(userPage.items);
      }
      if (role === 'SYSTEM_ADMIN') {
        const divisionPage = await apiRequest<{ items: Option[] }>('/api/admin/divisions?pageSize=50').catch(() => ({ items: [] }));
        setDivisions(divisionPage.items);
      }
    };
    load();
  }, [role]);

  const exportCsv = async () => {
    try {
      const response = await fetch(`/api/submissions/export?${query}`);
      const text = await response.text();
      if (!response.ok) {
        const body = JSON.parse(text) as { message?: string };
        throw new Error(body.message || 'Export failed');
      }
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'submissions.csv';
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Export ready');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Export failed');
    }
  };

  const pages = Math.max(1, Math.ceil(total / 20));
  const setFilter = (key: keyof typeof filters, value: string) => {
    setPage(1);
    setFilters(current => ({ ...current, [key]: value }));
  };

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Submissions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Each row keeps the division, lobby, and form version from the moment it was submitted.
          </p>
        </div>
        {canExport ? <Button className="h-9" variant="outline" onClick={exportCsv}>Export CSV</Button> : null}
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        <Input aria-label="Search submissions" placeholder="Search form or person" value={filters.search} onChange={event => setFilter('search', event.target.value)} />
        <select aria-label="Form" className="h-9 rounded-md border bg-background px-3 text-sm" value={filters.formId} onChange={event => setFilter('formId', event.target.value)}>
          <option value="">All forms</option>
          {forms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        {registers.length > 0 ? (
          <select aria-label="Register" className="h-9 rounded-md border bg-background px-3 text-sm" value={filters.registerId} onChange={event => setFilter('registerId', event.target.value)}>
            <option value="">All registers</option>
            {registers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        ) : null}
        <select aria-label="Lobby" className="h-9 rounded-md border bg-background px-3 text-sm" value={filters.lobbyId} onChange={event => setFilter('lobbyId', event.target.value)}>
          <option value="">All lobbies</option>
          {lobbies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        {users.length > 0 ? (
          <select aria-label="Crew" className="h-9 rounded-md border bg-background px-3 text-sm" value={filters.userId} onChange={event => setFilter('userId', event.target.value)}>
            <option value="">All crew</option>
            {users.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        ) : null}
        {role === 'SYSTEM_ADMIN' ? (
          <select aria-label="Division" className="h-9 rounded-md border bg-background px-3 text-sm" value={filters.divisionId} onChange={event => setFilter('divisionId', event.target.value)}>
            <option value="">All divisions</option>
            {divisions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        ) : null}
        <select aria-label="Status" className="h-9 rounded-md border bg-background px-3 text-sm" value={filters.status} onChange={event => setFilter('status', event.target.value)}>
          <option value="">All statuses</option>
          <option value="COMPLETED">Completed</option>
          <option value="PENDING">Pending</option>
        </select>
        <Input aria-label="Date from" type="date" value={filters.dateFrom} onChange={event => setFilter('dateFrom', event.target.value)} />
        <Input aria-label="Date to" type="date" value={filters.dateTo} onChange={event => setFilter('dateTo', event.target.value)} />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? <TableSkeleton /> : null}
      {!loading && items.length === 0 ? (
        <EmptyState title="No submissions" body="Submissions that match these filters will show up here." />
      ) : null}
      {!loading && items.length > 0 ? (
        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Submission ID</th>
                <th className="px-4 py-3 font-medium">Form</th>
                <th className="px-4 py-3 font-medium">Crew</th>
                <th className="px-4 py-3 font-medium">Lobby</th>
                <th className="px-4 py-3 font-medium">Submitted at</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="px-4 py-3 tabular-nums">{item.id}</td>
                  <td className="px-4 py-3">{item.form.name}</td>
                  <td className="px-4 py-3">{item.submittedBy.loginId || item.submittedBy.name}</td>
                  <td className="px-4 py-3">{item.lobby?.name || '—'}</td>
                  <td className="px-4 py-3">{new Date(item.submittedAt).toLocaleString()}</td>
                  <td className="px-4 py-3"><StatusPill status={item.status} /></td>
                  <td className="px-4 py-3">
                    <Link className="font-medium underline" href={`/submissions/${item.id}`}>View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="flex items-center justify-between text-sm">
        <p className="text-muted-foreground">{total} submissions</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-8" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button variant="outline" className="h-8" disabled={page >= pages} onClick={() => setPage(current => current + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}
