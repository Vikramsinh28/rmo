'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/components/organisms/modules/administration/api';
import { formatIstDate, istDaysAgo, istMonthsAgo } from '@/lib/rmo/datetime';
import { useAuthStore } from '@/store/auth';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BarList, TrendChart } from './Charts';
import { TableSkeleton } from './form-ui';

interface Option {
  id: number;
  name: string;
}

interface Metrics {
  total: number;
  today: number;
  week: number;
  month: number;
  pending: number;
  completed: number;
}

interface AnalyticsPayload {
  metrics: Metrics;
  status: Array<{ status: string; count: number }>;
  source?: Array<{ source: string; count: number }>;
  trend: { bucket: string; points: Array<{ label: string; count: number }> };
}

export function AnalyticsScreen() {
  const role = useAuthStore(state => state.user?.rmoRole);
  const today = formatIstDate(new Date());
  const [filters, setFilters] = useState({
    dateFrom: istDaysAgo(29),
    dateTo: today,
    divisionId: '',
    lobbyId: '',
    formId: '',
    registerId: '',
    crewTypeId: '',
    dutyTypeId: '',
    status: '',
    source: '',
  });
  const [divisions, setDivisions] = useState<Option[]>([]);
  const [lobbies, setLobbies] = useState<Option[]>([]);
  const [forms, setForms] = useState<Option[]>([]);
  const [registers, setRegisters] = useState<Option[]>([]);
  const [crewTypes, setCrewTypes] = useState<Option[]>([]);
  const [dutyTypes, setDutyTypes] = useState<Option[]>([]);
  const [payload, setPayload] = useState<AnalyticsPayload | null>(null);
  const [byForm, setByForm] = useState<Array<{ name: string; count: number }>>([]);
  const [byLobby, setByLobby] = useState<Array<{ name: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const query = useMemo(() => {
    const search = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) search.set(key, value);
    });
    return search.toString();
  }, [filters]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiRequest<AnalyticsPayload>(`/api/analytics/submissions?${query}`),
      apiRequest<{ items: Array<{ name: string; count: number }> }>(`/api/analytics/forms?${query}`),
      apiRequest<{ items: Array<{ name: string; count: number }> }>(`/api/analytics/lobbies?${query}`),
    ])
      .then(([summary, formsResult, lobbiesResult]) => {
        setPayload(summary);
        setByForm(formsResult.items);
        setByLobby(lobbiesResult.items);
        setError('');
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load analytics'))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    apiRequest<{ items: Option[] }>('/api/admin/forms?pageSize=50').then(result => setForms(result.items)).catch(() => setForms([]));
    apiRequest<{ items: Option[] }>('/api/admin/lobbies?pageSize=50').then(result => setLobbies(result.items)).catch(() => setLobbies([]));
    apiRequest<{ items: Option[] }>('/api/admin/registers?pageSize=50').then(result => setRegisters(result.items)).catch(() => setRegisters([]));
    apiRequest<Array<{ id: number; name: string }>>('/api/admin/crew-types?activeOnly=true')
      .then(items => setCrewTypes(items.map(item => ({ id: item.id, name: item.name }))))
      .catch(() => setCrewTypes([]));
    apiRequest<Array<{ id: number; name: string }>>('/api/admin/duty-types?activeOnly=true')
      .then(items => setDutyTypes(items.map(item => ({ id: item.id, name: item.name }))))
      .catch(() => setDutyTypes([]));
    if (role === 'SYSTEM_ADMIN') {
      apiRequest<{ items: Option[] }>('/api/admin/divisions?pageSize=50')
        .then(result => setDivisions(result.items))
        .catch(() => setDivisions([]));
    }
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

  const exportExcel = async () => {
    try {
      const response = await fetch(`/api/submissions/export/xlsx?${query}`);
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message || 'Export failed');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] || 'submissions.xlsx';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Excel export ready');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Export failed');
    }
  };

  const cards = payload
    ? [
        ['Total submissions', payload.metrics.total],
        ['Today', payload.metrics.today],
        ['This week', payload.metrics.week],
        ['This month', payload.metrics.month],
        ['Pending', payload.metrics.pending],
        ['Completed', payload.metrics.completed],
      ]
    : [];

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Counts come from submissions in the selected scope.
            {payload ? ` Trend is grouped by ${payload.trend.bucket}.` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button className="h-9" variant="outline" onClick={exportCsv}>Export CSV</Button>
          <Button className="h-9" variant="outline" onClick={exportExcel}>Export Excel</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="h-8" onClick={() => setFilters(current => ({ ...current, dateFrom: istDaysAgo(6), dateTo: today }))}>Last 7 days</Button>
        <Button variant="outline" className="h-8" onClick={() => setFilters(current => ({ ...current, dateFrom: istDaysAgo(29), dateTo: today }))}>Last 30 days</Button>
        <Button variant="outline" className="h-8" onClick={() => setFilters(current => ({ ...current, dateFrom: istMonthsAgo(3), dateTo: today }))}>Last 3 months</Button>
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        <Input aria-label="Date from" type="date" value={filters.dateFrom} onChange={event => setFilters(current => ({ ...current, dateFrom: event.target.value }))} />
        <Input aria-label="Date to" type="date" value={filters.dateTo} onChange={event => setFilters(current => ({ ...current, dateTo: event.target.value }))} />
        {role === 'SYSTEM_ADMIN' ? (
          <select aria-label="Division" className="h-9 rounded-md border bg-background px-3 text-sm" value={filters.divisionId} onChange={event => setFilters(current => ({ ...current, divisionId: event.target.value }))}>
            <option value="">All divisions</option>
            {divisions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        ) : null}
        <select aria-label="Lobby" className="h-9 rounded-md border bg-background px-3 text-sm" value={filters.lobbyId} onChange={event => setFilters(current => ({ ...current, lobbyId: event.target.value }))}>
          <option value="">All lobbies</option>
          {lobbies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select aria-label="Form" className="h-9 rounded-md border bg-background px-3 text-sm" value={filters.formId} onChange={event => setFilters(current => ({ ...current, formId: event.target.value }))}>
          <option value="">All forms</option>
          {forms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select aria-label="Register" className="h-9 rounded-md border bg-background px-3 text-sm" value={filters.registerId} onChange={event => setFilters(current => ({ ...current, registerId: event.target.value }))}>
          <option value="">All registers</option>
          {registers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select aria-label="Crew type" className="h-9 rounded-md border bg-background px-3 text-sm" value={filters.crewTypeId} onChange={event => setFilters(current => ({ ...current, crewTypeId: event.target.value }))}>
          <option value="">All crew types</option>
          {crewTypes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select aria-label="Duty type" className="h-9 rounded-md border bg-background px-3 text-sm" value={filters.dutyTypeId} onChange={event => setFilters(current => ({ ...current, dutyTypeId: event.target.value }))}>
          <option value="">All duty types</option>
          {dutyTypes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select aria-label="Status" className="h-9 rounded-md border bg-background px-3 text-sm" value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))}>
          <option value="">All statuses</option>
          <option value="COMPLETED">Completed</option>
          <option value="PENDING">Pending</option>
        </select>
        <select aria-label="Submission source" className="h-9 rounded-md border bg-background px-3 text-sm" value={filters.source} onChange={event => setFilters(current => ({ ...current, source: event.target.value }))}>
          <option value="">All sources</option>
          <option value="AUTHENTICATED">Authenticated</option>
          <option value="PUBLIC_QR">Public QR</option>
        </select>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? <TableSkeleton /> : null}
      {!loading && payload ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map(([label, value]) => (
              <article key={String(label)} className="rounded-xl border bg-card px-4 py-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
              </article>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <article className="rounded-xl border bg-card p-4">
              <h2 className="text-sm font-medium">Submission trend</h2>
              <TrendChart points={payload.trend.points} />
            </article>
            <article className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-sm font-medium">Status</h2>
              <BarList
                items={payload.status.map(item => ({ label: item.status, count: item.count }))}
                empty="No submissions in this range."
              />
            </article>
            <article className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-sm font-medium">Submission source</h2>
              <BarList
                items={(payload.source || []).map(item => ({
                  label: item.source === 'PUBLIC_QR' ? 'Public QR' : 'Authenticated',
                  count: item.count,
                }))}
                empty="No submissions in this range."
              />
            </article>
            <article className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-sm font-medium">Submissions by form</h2>
              <BarList items={byForm.map(item => ({ label: item.name, count: item.count }))} empty="No form activity in this range." />
            </article>
            <article className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-sm font-medium">Submissions by lobby</h2>
              <BarList items={byLobby.map(item => ({ label: item.name, count: item.count }))} empty="No lobby activity in this range." />
            </article>
          </div>
        </>
      ) : null}
    </div>
  );
}
