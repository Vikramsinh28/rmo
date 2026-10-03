'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiRequest } from '@/components/organisms/modules/administration/api';
import { formatIstDisplay } from '@/lib/rmo/datetime';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BarList, TrendChart } from './Charts';
import { EmptyState, StatusPill, TableSkeleton } from './form-ui';

type Tab = 'entries' | 'analytics' | 'export' | 'mapping';

interface RegisterMeta {
  id: number;
  name: string;
  description: string;
  status: string;
  formId: number | null;
  division: { id?: number; name: string };
  questionCount?: number;
}

interface MappingRow {
  id: number;
  formId: number;
  formVersionId: number;
  fieldId: string;
  fieldKey: string;
  columnLabel: string | null;
  isKeyField: boolean;
  sortOrder: number;
  label?: string;
  sourceLabel?: string;
  form: { id: number; name: string };
  formVersion: { id: number; versionNumber: number };
  crewType: { id: number; code: string; name: string } | null;
  dutyType: { id: number; code: string; name: string } | null;
}

interface Option {
  id: number;
  name: string;
  code?: string;
}

interface QuestionOption {
  formId: number;
  formName: string;
  formVersionId: number;
  versionNumber: number;
  crewType: Option | null;
  dutyType: Option | null;
  fieldId: string;
  fieldKey: string;
  label: string;
  type: string;
}

interface ColumnMeta {
  key: string;
  header: string;
  fieldKey: string;
  isKeyField: boolean;
  sourceLabel?: string;
}

interface EntryRow {
  submissionId: number;
  submittedAt: string;
  status: string;
  lobby: { name: string } | null;
  submittedBy: { name: string; loginId: string | null };
  crewType: { code: string; name: string } | null;
  dutyType: { code: string; name: string } | null;
  form: { name: string } | null;
  formVersion: { versionNumber: number } | null;
  values: Record<string, string>;
}

interface AnalyticsPayload {
  metrics: {
    total: number;
    today: number;
    week: number;
    month: number;
    uniqueCrew: number;
    uniqueLobbies: number;
    completed: number;
    pending: number;
  };
  trend: { bucket: string; points: Array<{ label: string; count: number }> };
  byCrewType: Array<{ label: string; count: number }>;
  byDutyType: Array<{ label: string; count: number }>;
  byLobby: Array<{ label: string; count: number }>;
  byCrew: Array<{ label: string; count: number }>;
  byStatus: Array<{ label: string; count: number }>;
  fieldStats?: {
    numeric: Array<{
      question: string;
      total: number;
      average: number;
      minimum: number;
      maximum: number;
      count: number;
    }>;
    yesNo: Array<{
      question: string;
      total: number;
      options: Array<{ label: string; count: number; percentage: number }>;
    }>;
    select: Array<{
      question: string;
      total: number;
      options: Array<{ label: string; count: number; percentage: number }>;
    }>;
  };
}

export function RegisterDetailScreen({ registerId }: { registerId: number }) {
  const role = useAuthStore(state => state.user?.rmoRole);
  const canEdit = role === 'SYSTEM_ADMIN' || role === 'DIVISION_ADMIN';
  const canExport = canEdit;
  const [tab, setTab] = useState<Tab>('entries');
  const [register, setRegister] = useState<RegisterMeta | null>(null);
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [columns, setColumns] = useState<ColumnMeta[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    search: '',
    dateFrom: '',
    dateTo: '',
    crewTypeId: '',
    dutyTypeId: '',
    lobbyId: '',
    status: '',
  });
  const [crewTypes, setCrewTypes] = useState<Option[]>([]);
  const [dutyTypes, setDutyTypes] = useState<Option[]>([]);
  const [lobbies, setLobbies] = useState<Option[]>([]);
  const [picker, setPicker] = useState({
    crewTypeId: '',
    dutyTypeId: '',
    formVersionId: '',
    fieldId: '',
    columnLabel: '',
  });
  const [questionOptions, setQuestionOptions] = useState<QuestionOption[]>([]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params.toString();
  }, [filters, page]);

  const loadCore = async () => {
    const [registerData, fieldsData] = await Promise.all([
      apiRequest<RegisterMeta>(`/api/admin/registers/${registerId}`),
      apiRequest<{ fields: MappingRow[] }>(`/api/admin/registers/${registerId}/fields`),
    ]);
    setRegister(registerData);
    setMappings(fieldsData.fields);
  };

  const loadEntries = async () => {
    const data = await apiRequest<{
      columns: ColumnMeta[];
      entries: EntryRow[];
      total: number;
    }>(`/api/admin/registers/${registerId}/entries?${query}`);
    setColumns(data.columns);
    setEntries(data.entries);
    setTotal(data.total);
  };

  const loadAnalytics = async () => {
    const data = await apiRequest<AnalyticsPayload>(
      `/api/admin/registers/${registerId}/analytics?${query}`,
    );
    setAnalytics(data);
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadCore(),
      tab === 'entries' || tab === 'export' ? loadEntries() : Promise.resolve(),
      tab === 'analytics' ? loadAnalytics() : Promise.resolve(),
    ])
      .then(() => setError(''))
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load register'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerId, query, tab]);

  useEffect(() => {
    apiRequest<Option[] | { items: Option[] }>('/api/admin/crew-types')
      .then(result => setCrewTypes(Array.isArray(result) ? result : result.items))
      .catch(() => setCrewTypes([]));
    apiRequest<Option[] | { items: Option[] }>('/api/admin/duty-types')
      .then(result => setDutyTypes(Array.isArray(result) ? result : result.items))
      .catch(() => setDutyTypes([]));
    apiRequest<{ items: Option[] }>('/api/admin/lobbies?pageSize=50')
      .then(result => setLobbies(result.items))
      .catch(() => setLobbies([]));
  }, []);

  useEffect(() => {
    if (!canEdit || tab !== 'mapping') return;
    const params = new URLSearchParams();
    if (picker.crewTypeId) params.set('crewTypeId', picker.crewTypeId);
    if (picker.dutyTypeId) params.set('dutyTypeId', picker.dutyTypeId);
    if (register?.division?.id) params.set('divisionId', String(register.division.id));
    apiRequest<{ items: QuestionOption[] }>(
      `/api/admin/registers/question-options?${params.toString()}`,
    )
      .then(result => setQuestionOptions(result.items))
      .catch(() => setQuestionOptions([]));
  }, [canEdit, tab, picker.crewTypeId, picker.dutyTypeId, register?.division?.id]);

  const versionOptions = useMemo(() => {
    const map = new Map<number, QuestionOption>();
    for (const item of questionOptions) {
      if (!map.has(item.formVersionId)) map.set(item.formVersionId, item);
    }
    return Array.from(map.values());
  }, [questionOptions]);

  const fieldsForVersion = useMemo(
    () =>
      questionOptions.filter(
        item =>
          !picker.formVersionId || String(item.formVersionId) === picker.formVersionId,
      ),
    [questionOptions, picker.formVersionId],
  );

  const addMapping = async (event: FormEvent) => {
    event.preventDefault();
    const selected = fieldsForVersion.find(item => item.fieldId === picker.fieldId);
    if (!selected) {
      toast.error('Select a question');
      return;
    }
    try {
      await apiRequest(`/api/admin/registers/${registerId}/fields`, {
        method: 'POST',
        body: JSON.stringify({
          formId: selected.formId,
          formVersionId: selected.formVersionId,
          fieldId: selected.fieldId,
          crewTypeId: selected.crewType?.id ?? null,
          dutyTypeId: selected.dutyType?.id ?? null,
          columnLabel: picker.columnLabel || selected.label,
        }),
      });
      toast.success('Question added');
      setPicker(current => ({ ...current, fieldId: '', columnLabel: '' }));
      await loadCore();
      if (tab === 'entries') await loadEntries();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not add question');
    }
  };

  const removeMapping = async (mappingId: number) => {
    try {
      await apiRequest(`/api/admin/registers/${registerId}/fields/${mappingId}`, {
        method: 'DELETE',
      });
      toast.success('Question removed');
      await loadCore();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not remove question');
    }
  };

  const moveMapping = async (mappingId: number, direction: -1 | 1) => {
    const index = mappings.findIndex(row => row.id === mappingId);
    if (index < 0) return;
    const next = index + direction;
    if (next < 0 || next >= mappings.length) return;
    const ordered = mappings.map(row => row.id);
    const [item] = ordered.splice(index, 1);
    ordered.splice(next, 0, item!);
    try {
      const result = await apiRequest<{ fields: MappingRow[] }>(
        `/api/admin/registers/${registerId}/fields`,
        {
          method: 'POST',
          body: JSON.stringify({ action: 'reorder', orderedIds: ordered }),
        },
      );
      setMappings(result.fields);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Reorder failed');
    }
  };

  const updateColumnLabel = async (mappingId: number, columnLabel: string) => {
    try {
      await apiRequest(`/api/admin/registers/${registerId}/fields/${mappingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ columnLabel }),
      });
      await loadCore();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Update failed');
    }
  };

  const toggleKey = async (mapping: MappingRow) => {
    try {
      await apiRequest(`/api/admin/registers/${registerId}/fields/${mapping.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isKeyField: !mapping.isKeyField }),
      });
      await loadCore();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Update failed');
    }
  };

  const download = async (format: 'xlsx' | 'csv') => {
    try {
      const params = new URLSearchParams(query);
      if (format === 'csv') params.set('format', 'csv');
      const response = await fetch(`/api/admin/registers/${registerId}/export?${params}`);
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = format === 'csv' ? 'register.csv' : 'register.xlsx';
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Export failed');
    }
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'entries', label: 'Entries' },
    { id: 'analytics', label: 'Analytics' },
    ...(canExport ? [{ id: 'export' as const, label: 'Export' }] : []),
    ...(canEdit ? [{ id: 'mapping' as const, label: 'Column Mapping' }] : []),
  ];

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div>
        <Link href="/registers" className="text-xs text-muted-foreground underline">
          Back to registers
        </Link>
        {register ? (
          <>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{register.name}</h1>
            <p className="text-sm text-muted-foreground">
              {register.division.name} · <StatusPill status={register.status} />
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{register.description || '—'}</p>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-2">
        {tabs.map(item => (
          <button
            key={item.id}
            type="button"
            className={`rounded-md px-3 py-1.5 text-sm ${
              tab === item.id ? 'bg-foreground text-background' : 'border'
            }`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-7">
        <Input
          aria-label="Search"
          placeholder="Search crew"
          value={filters.search}
          onChange={event => {
            setPage(1);
            setFilters(current => ({ ...current, search: event.target.value }));
          }}
        />
        <Input
          aria-label="Date from"
          type="date"
          value={filters.dateFrom}
          onChange={event => {
            setPage(1);
            setFilters(current => ({ ...current, dateFrom: event.target.value }));
          }}
        />
        <Input
          aria-label="Date to"
          type="date"
          value={filters.dateTo}
          onChange={event => {
            setPage(1);
            setFilters(current => ({ ...current, dateTo: event.target.value }));
          }}
        />
        <select
          aria-label="Staff type"
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={filters.crewTypeId}
          onChange={event => {
            setPage(1);
            setFilters(current => ({ ...current, crewTypeId: event.target.value }));
          }}
        >
          <option value="">All staff types</option>
          {crewTypes.map(item => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Duty type"
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={filters.dutyTypeId}
          onChange={event => {
            setPage(1);
            setFilters(current => ({ ...current, dutyTypeId: event.target.value }));
          }}
        >
          <option value="">All duty types</option>
          {dutyTypes.map(item => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Lobby"
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={filters.lobbyId}
          onChange={event => {
            setPage(1);
            setFilters(current => ({ ...current, lobbyId: event.target.value }));
          }}
        >
          <option value="">All lobbies</option>
          {lobbies.map(item => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={filters.status}
          onChange={event => {
            setPage(1);
            setFilters(current => ({ ...current, status: event.target.value }));
          }}
        >
          <option value="">All statuses</option>
          <option value="COMPLETED">Completed</option>
          <option value="PENDING">Pending</option>
        </select>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? <TableSkeleton /> : null}

      {!loading && tab === 'entries' ? (
        entries.length === 0 ? (
          <EmptyState
            title="No entries"
            body="Mapped questions from submitted forms will appear here."
          />
        ) : (
          <div className="overflow-auto rounded-xl border bg-card">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 border-b bg-muted/80 text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Crew</th>
                  <th className="px-3 py-2 font-medium">Staff</th>
                  <th className="px-3 py-2 font-medium">Duty</th>
                  <th className="px-3 py-2 font-medium">Lobby</th>
                  {columns.map(column => (
                    <th key={column.key} className="px-3 py-2 font-medium">
                      {column.header}
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <tr key={entry.submissionId} className="border-b last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatIstDisplay(entry.submittedAt)}
                    </td>
                    <td className="px-3 py-2">
                      {entry.submittedBy.loginId || entry.submittedBy.name}
                    </td>
                    <td className="px-3 py-2">{entry.crewType?.code || '—'}</td>
                    <td className="px-3 py-2">{entry.dutyType?.code || '—'}</td>
                    <td className="px-3 py-2">{entry.lobby?.name || '—'}</td>
                    {columns.map(column => (
                      <td key={column.key} className="px-3 py-2">
                        {entry.values[column.key] || '—'}
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      <Link
                        className="underline"
                        href={`/submissions/${entry.submissionId}`}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
              <span>
                {(page - 1) * 20 + 1}-{Math.min(page * 20, total)} of {total}
              </span>
              <div className="flex gap-2">
                <Button
                  className="h-7"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage(current => current - 1)}
                >
                  Prev
                </Button>
                <Button
                  className="h-7"
                  variant="outline"
                  disabled={page * 20 >= total}
                  onClick={() => setPage(current => current + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        )
      ) : null}

      {!loading && tab === 'analytics' && analytics ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Total entries', analytics.metrics.total],
              ['Today', analytics.metrics.today],
              ['This week', analytics.metrics.week],
              ['This month', analytics.metrics.month],
              ['Unique crew', analytics.metrics.uniqueCrew],
              ['Unique lobbies', analytics.metrics.uniqueLobbies],
              ['Completed', analytics.metrics.completed],
              ['Pending', analytics.metrics.pending],
            ].map(([label, value]) => (
              <article key={String(label)} className="rounded-xl border bg-card px-4 py-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
              </article>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <article className="rounded-xl border bg-card p-4">
              <h2 className="text-sm font-medium">Trend</h2>
              <TrendChart points={analytics.trend.points} />
            </article>
            <article className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-sm font-medium">By staff type</h2>
              <BarList items={analytics.byCrewType} empty="No data" />
            </article>
            <article className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-sm font-medium">By duty type</h2>
              <BarList items={analytics.byDutyType} empty="No data" />
            </article>
            <article className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-sm font-medium">By lobby</h2>
              <BarList items={analytics.byLobby} empty="No data" />
            </article>
            <article className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-sm font-medium">By crew</h2>
              <BarList items={analytics.byCrew} empty="No data" />
            </article>
            <article className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-sm font-medium">Status</h2>
              <BarList items={analytics.byStatus} empty="No data" />
            </article>
          </div>
          {analytics.fieldStats?.numeric?.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {analytics.fieldStats.numeric.map(item => (
                <article key={item.question} className="rounded-xl border bg-card p-4">
                  <h3 className="text-sm font-medium">{item.question}</h3>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Total</dt>
                      <dd className="font-medium tabular-nums">{item.total}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Average</dt>
                      <dd className="font-medium tabular-nums">{item.average}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Min</dt>
                      <dd className="font-medium tabular-nums">{item.minimum}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Max</dt>
                      <dd className="font-medium tabular-nums">{item.maximum}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          ) : null}
          {(analytics.fieldStats?.yesNo?.length || analytics.fieldStats?.select?.length) ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {[...(analytics.fieldStats?.yesNo || []), ...(analytics.fieldStats?.select || [])].map(
                item => (
                  <article key={item.question} className="rounded-xl border bg-card p-4">
                    <h3 className="mb-3 text-sm font-medium">{item.question}</h3>
                    <BarList
                      items={item.options.map(option => ({
                        label: `${option.label} (${option.percentage}%)`,
                        count: option.count,
                      }))}
                      empty="No data"
                    />
                  </article>
                ),
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {!loading && tab === 'export' ? (
        <section className="space-y-4 rounded-xl border bg-card p-4">
          <div>
            <h2 className="text-sm font-medium">Export register</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Uses the same filters as Entries ({total} rows, {columns.length} mapped columns).
            </p>
          </div>
          {entries.length > 0 ? (
            <div className="overflow-auto rounded-lg border">
              <table className="min-w-full text-left text-xs">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-2 py-1.5">Crew</th>
                    {columns.slice(0, 6).map(column => (
                      <th key={column.key} className="px-2 py-1.5">
                        {column.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.slice(0, 5).map(entry => (
                    <tr key={entry.submissionId} className="border-b last:border-0">
                      <td className="px-2 py-1.5">
                        {entry.submittedBy.loginId || entry.submittedBy.name}
                      </td>
                      {columns.slice(0, 6).map(column => (
                        <td key={column.key} className="px-2 py-1.5">
                          {entry.values[column.key] || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No rows match the current filters.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button className="h-9" onClick={() => download('xlsx')}>
              Download XLSX
            </Button>
            <Button className="h-9" variant="outline" onClick={() => download('csv')}>
              Download CSV
            </Button>
          </div>
        </section>
      ) : null}

      {!loading && tab === 'mapping' && canEdit ? (
        <div className="space-y-4">
          <form className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-2" onSubmit={addMapping}>
            <h2 className="md:col-span-2 text-sm font-medium">Add question to register</h2>
            <div className="space-y-1.5">
              <Label>Staff type</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={picker.crewTypeId}
                onChange={event =>
                  setPicker(current => ({
                    ...current,
                    crewTypeId: event.target.value,
                    formVersionId: '',
                    fieldId: '',
                  }))
                }
              >
                <option value="">All</option>
                {crewTypes.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Duty type</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={picker.dutyTypeId}
                onChange={event =>
                  setPicker(current => ({
                    ...current,
                    dutyTypeId: event.target.value,
                    formVersionId: '',
                    fieldId: '',
                  }))
                }
              >
                <option value="">All</option>
                {dutyTypes.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Form / version</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={picker.formVersionId}
                onChange={event =>
                  setPicker(current => ({
                    ...current,
                    formVersionId: event.target.value,
                    fieldId: '',
                  }))
                }
              >
                <option value="">Select form version</option>
                {versionOptions.map(item => (
                  <option key={item.formVersionId} value={item.formVersionId}>
                    {item.crewType?.code || '—'} / {item.dutyType?.code || '—'} / {item.formName}{' '}
                    (v{item.versionNumber})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Question</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={picker.fieldId}
                onChange={event => {
                  const selected = fieldsForVersion.find(item => item.fieldId === event.target.value);
                  setPicker(current => ({
                    ...current,
                    fieldId: event.target.value,
                    columnLabel: selected?.label || current.columnLabel,
                  }));
                }}
              >
                <option value="">Select question</option>
                {fieldsForVersion.map(item => (
                  <option key={`${item.formVersionId}-${item.fieldId}`} value={item.fieldId}>
                    {item.label} ({item.type})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Column label</Label>
              <Input
                value={picker.columnLabel}
                onChange={event =>
                  setPicker(current => ({ ...current, columnLabel: event.target.value }))
                }
              />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" className="h-9">
                Add question
              </Button>
            </div>
          </form>

          {mappings.length === 0 ? (
            <EmptyState title="No mapped questions" body="Add questions from published form versions." />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Question</th>
                    <th className="px-3 py-2">Column label</th>
                    <th className="px-3 py-2">Key</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((mapping, index) => (
                    <tr key={mapping.id} className="border-b last:border-0">
                      <td className="px-3 py-2 tabular-nums">{index + 1}</td>
                      <td className="px-3 py-2 text-xs">{mapping.sourceLabel}</td>
                      <td className="px-3 py-2">{mapping.fieldKey}</td>
                      <td className="px-3 py-2">
                        <Input
                          className="h-8"
                          defaultValue={mapping.columnLabel || mapping.label || ''}
                          onBlur={event => {
                            if (event.target.value !== (mapping.columnLabel || '')) {
                              void updateColumnLabel(mapping.id, event.target.value);
                            }
                          }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={mapping.isKeyField}
                          onChange={() => void toggleKey(mapping)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <button type="button" className="underline" onClick={() => void moveMapping(mapping.id, -1)}>
                            Up
                          </button>
                          <button type="button" className="underline" onClick={() => void moveMapping(mapping.id, 1)}>
                            Down
                          </button>
                          <button type="button" className="underline text-destructive" onClick={() => void removeMapping(mapping.id)}>
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
