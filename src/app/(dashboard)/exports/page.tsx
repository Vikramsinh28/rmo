'use client';

import { Button } from '@/components/ui/button';
import { apiRequest } from '@/components/organisms/modules/administration/api';
import { useAuthStore } from '@/store/auth';
import { useEffect, useState } from 'react';

interface Option {
  id: number;
  name: string;
  code?: string;
}

export default function ExportsPage() {
  const role = useAuthStore(state => state.user?.rmoRole);
  const [divisions, setDivisions] = useState<Option[]>([]);
  const [lobbies, setLobbies] = useState<Option[]>([]);
  const [crewTypes, setCrewTypes] = useState<Option[]>([]);
  const [dutyTypes, setDutyTypes] = useState<Option[]>([]);
  const [registers, setRegisters] = useState<Option[]>([]);
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    divisionId: '',
    lobbyId: '',
    crewTypeId: '',
    dutyTypeId: '',
    registerTypeId: '',
    status: '',
  });

  useEffect(() => {
    if (role === 'SYSTEM_ADMIN') {
      apiRequest<{ items: Option[] }>('/api/admin/divisions?pageSize=100')
        .then(result => setDivisions(result.items))
        .catch(() => setDivisions([]));
    }
    apiRequest<{ items: Option[] }>('/api/admin/lobbies?pageSize=100')
      .then(result => setLobbies(result.items))
      .catch(() => setLobbies([]));
    apiRequest<{ items: Option[] }>('/api/admin/crew-types?pageSize=100')
      .then(result => setCrewTypes(result.items))
      .catch(() => setCrewTypes([]));
    apiRequest<{ items: Option[] }>('/api/admin/duty-types?pageSize=100')
      .then(result => setDutyTypes(result.items))
      .catch(() => setDutyTypes([]));
    apiRequest<{ items: Option[] }>('/api/admin/register-types?pageSize=100')
      .then(result => setRegisters(result.items))
      .catch(() => setRegisters([]));
  }, [role]);

  const download = async (format: 'csv' | 'xlsx') => {
    const params = new URLSearchParams({ format });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const response = await fetch(`/api/submissions/export?${params.toString()}`, {
      credentials: 'include',
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message || 'Export failed');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = format === 'xlsx' ? 'submissions.xlsx' : 'submissions.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Exports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Export submission answers. Register filter keeps only mapped questions.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <input
          type="date"
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={filters.dateFrom}
          onChange={event => setFilters(current => ({ ...current, dateFrom: event.target.value }))}
        />
        <input
          type="date"
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={filters.dateTo}
          onChange={event => setFilters(current => ({ ...current, dateTo: event.target.value }))}
        />
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={filters.status}
          onChange={event => setFilters(current => ({ ...current, status: event.target.value }))}
        >
          <option value="">All statuses</option>
          <option value="COMPLETED">COMPLETED</option>
          <option value="PENDING">PENDING</option>
        </select>
        {role === 'SYSTEM_ADMIN' ? (
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={filters.divisionId}
            onChange={event =>
              setFilters(current => ({ ...current, divisionId: event.target.value }))
            }
          >
            <option value="">All divisions</option>
            {divisions.map(row => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        ) : null}
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={filters.lobbyId}
          onChange={event => setFilters(current => ({ ...current, lobbyId: event.target.value }))}
        >
          <option value="">All lobbies</option>
          {lobbies.map(row => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={filters.crewTypeId}
          onChange={event =>
            setFilters(current => ({ ...current, crewTypeId: event.target.value }))
          }
        >
          <option value="">All crew types</option>
          {crewTypes.map(row => (
            <option key={row.id} value={row.id}>
              {row.code || row.name}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={filters.dutyTypeId}
          onChange={event =>
            setFilters(current => ({ ...current, dutyTypeId: event.target.value }))
          }
        >
          <option value="">All duty types</option>
          {dutyTypes.map(row => (
            <option key={row.id} value={row.id}>
              {row.code || row.name}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={filters.registerTypeId}
          onChange={event =>
            setFilters(current => ({ ...current, registerTypeId: event.target.value }))
          }
        >
          <option value="">All registers</option>
          {registers.map(row => (
            <option key={row.id} value={row.id}>
              {row.code || row.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <Button className="h-9" onClick={() => void download('csv')}>
          Export CSV
        </Button>
        <Button className="h-9" variant="outline" onClick={() => void download('xlsx')}>
          Export XLSX
        </Button>
      </div>
    </div>
  );
}
