'use client';

import { Input } from '@/components/ui/input';
import { apiRequest } from '@/components/organisms/modules/administration/api';
import { EmptyState, StatusPill, TableSkeleton } from '@/components/organisms/modules/forms/form-ui';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

interface EnrollmentRow {
  id: number;
  publicCode: string;
  fullName: string;
  email: string;
  employeeId: string;
  requestedLobby: { name: string };
  requestedDivision: { name: string };
  createdAt: string;
  status: string;
}

interface Page {
  items: EnrollmentRow[];
  total: number;
  pendingCount: number;
}

const controlClass = 'h-9 bg-background text-sm md:text-sm dark:border-zinc-600 dark:bg-zinc-950';

export function EnrollmentListScreen() {
  const role = useAuthStore(state => state.user?.rmoRole);
  const params = useSearchParams();
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(params.get('status') || '');
  const [divisionId, setDivisionId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [divisions, setDivisions] = useState<Array<{ id: number; name: string }>>([]);

  useEffect(() => {
    if (role !== 'SYSTEM_ADMIN') return;
    apiRequest<{ items: Array<{ id: number; name: string }> }>('/api/admin/divisions?pageSize=50')
      .then(result => setDivisions(result.items))
      .catch(() => setDivisions([]));
  }, [role]);

  useEffect(() => {
    const query = new URLSearchParams();
    if (search) query.set('search', search);
    if (status) query.set('status', status);
    if (divisionId) query.set('divisionId', divisionId);
    if (dateFrom) query.set('dateFrom', dateFrom);
    if (dateTo) query.set('dateTo', dateTo);
    query.set('pageSize', '20');
    setLoading(true);
    apiRequest<Page>(`/api/admin/crew-enrollments?${query.toString()}`)
      .then(result => {
        setPage(result);
        setError('');
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load enrollments'))
      .finally(() => setLoading(false));
  }, [search, status, divisionId, dateFrom, dateTo]);

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Crew enrollment</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {page ? `${page.pendingCount} pending` : 'Review requests'} in your division. Passwords are not shown.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Input aria-label="Search enrollments" className={controlClass} placeholder="Search name, email, or ID" value={search} onChange={event => setSearch(event.target.value)} />
        <select aria-label="Status" className={`${controlClass} rounded-md border px-3`} value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        {role === 'SYSTEM_ADMIN' ? (
          <select aria-label="Division" className={`${controlClass} rounded-md border px-3`} value={divisionId} onChange={event => setDivisionId(event.target.value)}>
            <option value="">All divisions</option>
            {divisions.map(division => <option key={division.id} value={division.id}>{division.name}</option>)}
          </select>
        ) : null}
        <Input aria-label="Date from" className={controlClass} type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} />
        <Input aria-label="Date to" className={controlClass} type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? <TableSkeleton /> : null}
      {!loading && page && page.items.length === 0 ? (
        <EmptyState title="No enrollments" body="Crew requests for this division will show up here." />
      ) : null}
      {!loading && page && page.items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Applicant</th>
                <th className="px-4 py-3 font-medium">Employee ID</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Requested lobby</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map(item => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{item.fullName}</td>
                  <td className="px-4 py-3">{item.employeeId}</td>
                  <td className="px-4 py-3">{item.email}</td>
                  <td className="px-4 py-3">
                    {item.requestedLobby.name}
                    {role === 'SYSTEM_ADMIN' ? (
                      <span className="block text-xs text-muted-foreground">{item.requestedDivision.name}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{new Date(item.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3"><StatusPill status={item.status} /></td>
                  <td className="px-4 py-3">
                    <Link className="font-medium underline" href={`/enrollments/${item.id}`}>Review</Link>
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
