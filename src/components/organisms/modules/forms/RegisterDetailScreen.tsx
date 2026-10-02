'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiRequest } from '@/components/organisms/modules/administration/api';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, StatusPill, TableSkeleton } from './form-ui';

interface RegisterMeta {
  id: number;
  name: string;
  description: string;
  status: string;
  formId: number;
  form: { name: string };
  division: { name: string };
}

interface FieldRow {
  fieldKey: string;
  sortOrder: number;
  columnLabel: string | null;
  isKeyField: boolean;
  label?: string;
}

interface AvailableField {
  key: string;
  label: string;
}

interface EntryRow {
  submissionId: number;
  submittedAt: string;
  status: string;
  lobby: { name: string } | null;
  submittedBy: { name: string; loginId: string | null };
  values: Record<string, string>;
}

interface ColumnMeta {
  key: string;
  header: string;
  fieldKey: string;
  isKeyField: boolean;
}

export function RegisterDetailScreen({ registerId }: { registerId: number }) {
  const role = useAuthStore(state => state.user?.rmoRole);
  const canEdit = role === 'SYSTEM_ADMIN' || role === 'DIVISION_ADMIN';
  const canExport = canEdit;
  const [register, setRegister] = useState<RegisterMeta | null>(null);
  const [availableFields, setAvailableFields] = useState<AvailableField[]>([]);
  const [draftFields, setDraftFields] = useState<FieldRow[]>([]);
  const [columns, setColumns] = useState<ColumnMeta[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedKey, setSelectedKey] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (search) params.set('search', search);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    return params.toString();
  }, [page, search, dateFrom, dateTo]);

  const load = () => {
    setLoading(true);
    Promise.all([
      apiRequest<RegisterMeta>(`/api/admin/registers/${registerId}`),
      apiRequest<{
        availableFields: AvailableField[];
        fields: FieldRow[];
      }>(`/api/admin/registers/${registerId}/fields`),
      apiRequest<{
        columns: ColumnMeta[];
        entries: EntryRow[];
        total: number;
      }>(`/api/admin/registers/${registerId}/entries?${query}`),
    ])
      .then(([registerData, fieldsData, entriesData]) => {
        setRegister(registerData);
        setAvailableFields(fieldsData.availableFields);
        setDraftFields(
          fieldsData.fields.map((field, index) => ({
            fieldKey: field.fieldKey,
            sortOrder: field.sortOrder ?? index,
            columnLabel: field.columnLabel,
            isKeyField: field.isKeyField,
            label: field.label,
          })),
        );
        setColumns(entriesData.columns);
        setEntries(entriesData.entries);
        setTotal(entriesData.total);
        setError('');
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load register'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerId, query]);

  const unusedFields = availableFields.filter(
    field => !draftFields.some(mapped => mapped.fieldKey === field.key),
  );

  const addField = () => {
    if (!selectedKey) return;
    const available = availableFields.find(field => field.key === selectedKey);
    if (!available) return;
    setDraftFields(current => [
      ...current,
      {
        fieldKey: available.key,
        sortOrder: current.length,
        columnLabel: null,
        isKeyField: false,
        label: available.label,
      },
    ]);
    setSelectedKey('');
  };

  const saveFields = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await apiRequest(`/api/admin/registers/${registerId}/fields`, {
        method: 'PUT',
        body: JSON.stringify({
          fields: draftFields.map((field, index) => ({
            fieldKey: field.fieldKey,
            sortOrder: index,
            columnLabel: field.columnLabel,
            isKeyField: field.isKeyField,
          })),
        }),
      });
      toast.success('Column mapping saved');
      load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Save failed');
    }
  };

  const exportExcel = async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const response = await fetch(`/api/admin/registers/${registerId}/export?${params}`);
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message || 'Export failed');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] || `register-${registerId}.xlsx`;
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

  const pages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link className="underline" href="/registers">Registers</Link>
            {' / '}
            {register?.name || `Register ${registerId}`}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {register?.name || 'Register'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {register
              ? `${register.form.name} · ${register.division.name}`
              : 'Column mapping and book entries for this register.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {register ? <StatusPill status={register.status} /> : null}
          {canExport ? (
            <Button className="h-9" variant="outline" onClick={exportExcel}>
              Export Excel
            </Button>
          ) : null}
          <Link className="inline-flex h-9 items-center rounded-md border px-3 text-sm" href={`/submissions?registerId=${registerId}`}>
            All submissions
          </Link>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading && !register ? <TableSkeleton /> : null}

      {canEdit ? (
        <form className="space-y-3 rounded-xl border bg-card p-4" onSubmit={saveFields}>
          <div>
            <h2 className="text-lg font-medium">Column mapping</h2>
            <p className="text-sm text-muted-foreground">
              Choose which published form fields appear as register columns. Mark key fields to
              require answers before a submission appears in the book.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1">
              <Label htmlFor="add-field">Add field</Label>
              <select
                id="add-field"
                className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={selectedKey}
                onChange={event => setSelectedKey(event.target.value)}
              >
                <option value="">Select field</option>
                {unusedFields.map(field => (
                  <option key={field.key} value={field.key}>
                    {field.label} ({field.key})
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" className="h-9" variant="outline" onClick={addField}>
              Add
            </Button>
            <Button type="submit" className="h-9">
              Save mapping
            </Button>
          </div>
          {draftFields.length === 0 ? (
            <EmptyState title="No columns mapped" body="Add fields from the published form to build this register book." />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Field</th>
                    <th className="px-3 py-2">Column label</th>
                    <th className="px-3 py-2">Key field</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {draftFields.map((field, index) => (
                    <tr key={field.fieldKey} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <p className="font-medium">{field.label || field.fieldKey}</p>
                        <p className="text-xs text-muted-foreground">{field.fieldKey}</p>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={field.columnLabel || ''}
                          placeholder={field.label || field.fieldKey}
                          onChange={event =>
                            setDraftFields(current =>
                              current.map((row, rowIndex) =>
                                rowIndex === index
                                  ? { ...row, columnLabel: event.target.value || null }
                                  : row,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={field.isKeyField}
                            onChange={event =>
                              setDraftFields(current =>
                                current.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? { ...row, isKeyField: event.target.checked }
                                    : row,
                                ),
                              )
                            }
                          />
                          Key
                        </label>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="underline"
                            disabled={index === 0}
                            onClick={() =>
                              setDraftFields(current => {
                                if (index === 0) return current;
                                const next = [...current];
                                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                                return next;
                              })
                            }
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            className="underline"
                            disabled={index === draftFields.length - 1}
                            onClick={() =>
                              setDraftFields(current => {
                                if (index >= current.length - 1) return current;
                                const next = [...current];
                                [next[index + 1], next[index]] = [next[index], next[index + 1]];
                                return next;
                              })
                            }
                          >
                            Down
                          </button>
                          <button
                            type="button"
                            className="underline text-destructive"
                            onClick={() =>
                              setDraftFields(current => current.filter((_, rowIndex) => rowIndex !== index))
                            }
                          >
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
        </form>
      ) : null}

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-medium">Entries</h2>
          <p className="text-sm text-muted-foreground">
            Submissions for this register&apos;s form that satisfy the key-field rules.
          </p>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <Input
            aria-label="Search entries"
            placeholder="Search person"
            value={search}
            onChange={event => {
              setPage(1);
              setSearch(event.target.value);
            }}
          />
          <Input
            aria-label="From date"
            type="date"
            value={dateFrom}
            onChange={event => {
              setPage(1);
              setDateFrom(event.target.value);
            }}
          />
          <Input
            aria-label="To date"
            type="date"
            value={dateTo}
            onChange={event => {
              setPage(1);
              setDateTo(event.target.value);
            }}
          />
        </div>
        {loading ? <TableSkeleton /> : null}
        {!loading && entries.length === 0 ? (
          <EmptyState
            title="No entries"
            body="Map columns and ensure submissions have answers on the key fields."
          />
        ) : null}
        {!loading && entries.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Person</th>
                  <th className="px-3 py-2">Lobby</th>
                  <th className="px-3 py-2">Submitted</th>
                  {columns.map(column => (
                    <th key={column.fieldKey} className="px-3 py-2">
                      {column.header}
                      {column.isKeyField ? ' *' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <tr key={entry.submissionId} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <Link className="font-medium underline" href={`/submissions/${entry.submissionId}`}>
                        {entry.submittedBy.loginId || entry.submittedBy.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{entry.lobby?.name || '—'}</td>
                    <td className="px-3 py-2">{new Date(entry.submittedAt).toLocaleString()}</td>
                    {columns.map(column => (
                      <td key={column.fieldKey} className="px-3 py-2">
                        {entry.values[column.fieldKey] || ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {pages > 1 ? (
          <div className="flex items-center gap-2">
            <Button className="h-8" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {pages} ({total} entries)
            </span>
            <Button className="h-8" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
