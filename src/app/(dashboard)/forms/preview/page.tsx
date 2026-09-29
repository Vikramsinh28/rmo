'use client';

import { apiRequest } from '@/components/organisms/modules/administration/api';
import type { FormSchema } from '@/types/form';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, FormFields, TableSkeleton } from '@/components/organisms/modules/forms/form-ui';

interface Option {
  id: number;
  code: string;
  name: string;
}

export default function FormPreviewPage() {
  const [crewTypes, setCrewTypes] = useState<Option[]>([]);
  const [dutyTypes, setDutyTypes] = useState<Option[]>([]);
  const [registers, setRegisters] = useState<Option[]>([]);
  const [crewTypeId, setCrewTypeId] = useState('');
  const [dutyTypeId, setDutyTypeId] = useState('');
  const [registerTypeId, setRegisterTypeId] = useState('');
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      apiRequest<{ items: Option[] }>('/api/admin/crew-types?status=ACTIVE&pageSize=100'),
      apiRequest<{ items: Option[] }>('/api/admin/duty-types?status=ACTIVE&pageSize=100'),
      apiRequest<{ items: Option[] }>('/api/admin/register-types?status=ACTIVE&pageSize=100'),
    ]).then(([crews, duties, regs]) => {
      setCrewTypes(crews.items);
      setDutyTypes(duties.items);
      setRegisters(regs.items);
    });
  }, []);

  useEffect(() => {
    if (!crewTypeId || !dutyTypeId) {
      setSchema(null);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({
      crewTypeId,
      dutyTypeId,
    });
    if (registerTypeId) params.set('registerTypeId', registerTypeId);
    apiRequest<{ schema: FormSchema }>(`/api/admin/crew-form/preview?${params.toString()}`)
      .then(result => setSchema(result.schema))
      .catch(cause => toast.error(cause instanceof Error ? cause.message : 'Preview failed'))
      .finally(() => setLoading(false));
  }, [crewTypeId, dutyTypeId, registerTypeId]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 lg:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Form Preview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Preview the one crew form for a crew type and duty type. Register filter is optional.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={crewTypeId}
          onChange={event => setCrewTypeId(event.target.value)}
        >
          <option value="">Crew type</option>
          {crewTypes.map(row => (
            <option key={row.id} value={row.id}>
              {row.code}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={dutyTypeId}
          onChange={event => setDutyTypeId(event.target.value)}
        >
          <option value="">Duty type</option>
          {dutyTypes.map(row => (
            <option key={row.id} value={row.id}>
              {row.code}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={registerTypeId}
          onChange={event => setRegisterTypeId(event.target.value)}
        >
          <option value="">All registers</option>
          {registers.map(row => (
            <option key={row.id} value={row.id}>
              {row.code}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <TableSkeleton />
      ) : !schema ? (
        <EmptyState title="Select crew type and duty type" />
      ) : (
        <FormFields schema={schema} answers={{}} readOnly />
      )}
    </div>
  );
}
