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
import { blankField, FormSchemaError, parseFormSchema } from '@/lib/rmo/form-schema';
import { FIELD_TYPES, type FormField, type FormSchema } from '@/types/form';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FormFields, StatusPill, TableSkeleton } from './form-ui';

const controlClass =
  'h-9 border-input bg-background text-sm text-foreground md:text-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50';

interface Division {
  id: number;
  name: string;
}

interface Lobby {
  id: number;
  name: string;
  divisionId: number;
}

interface LoadedForm {
  id: number;
  name: string;
  description: string;
  divisionId: number | null;
  status: string;
  schema: FormSchema;
  versions: Array<{ id: number; versionNumber: number; status: string }>;
  assignments: Array<{ divisionId: number; lobbyId: number | null }>;
  versionCreated?: boolean;
}

export function FormBuilderScreen({ formId }: { formId?: number }) {
  const router = useRouter();
  const role = useAuthStore(state => state.user?.rmoRole);
  const homeDivisionId = useAuthStore(state => state.user?.homeDivisionId);
  const canEdit = role === 'SYSTEM_ADMIN' || role === 'DIVISION_ADMIN';
  const [loading, setLoading] = useState(Boolean(formId));
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [systemWide, setSystemWide] = useState(false);
  const [status, setStatus] = useState('DRAFT');
  const [schema, setSchema] = useState<FormSchema>({ sections: ['General'], fields: [] });
  const [selected, setSelected] = useState(0);
  const [preview, setPreview] = useState(false);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [divisionWide, setDivisionWide] = useState(false);
  const [lobbyIds, setLobbyIds] = useState<number[]>([]);
  const [versions, setVersions] = useState<LoadedForm['versions']>([]);
  const [confirm, setConfirm] = useState<'archive' | 'publish' | 'delete' | null>(null);
  const [sectionName, setSectionName] = useState('');

  const apply = (form: LoadedForm) => {
    setName(form.name);
    setDescription(form.description);
    setDivisionId(form.divisionId ? String(form.divisionId) : '');
    setSystemWide(form.divisionId == null);
    setStatus(form.status);
    setSchema(form.schema);
    setVersions(form.versions);
    setDivisionWide(form.assignments.some(item => item.lobbyId == null));
    setLobbyIds(form.assignments.flatMap(item => (item.lobbyId == null ? [] : [item.lobbyId])));
  };

  useEffect(() => {
    if (role !== 'SYSTEM_ADMIN' && role !== 'DIVISION_ADMIN') return;
    apiRequest<{ items: Division[] }>('/api/admin/divisions?pageSize=50')
      .then(result => setDivisions(result.items))
      .catch(() => setDivisions([]));
  }, [role]);

  useEffect(() => {
    apiRequest<{ items: Lobby[] }>('/api/admin/lobbies?pageSize=50')
      .then(result => setLobbies(result.items))
      .catch(() => setLobbies([]));
  }, []);

  useEffect(() => {
    if (role === 'DIVISION_ADMIN' && homeDivisionId) {
      setDivisionId(String(homeDivisionId));
    }
  }, [role, homeDivisionId]);

  useEffect(() => {
    if (!formId) return;
    setLoading(true);
    apiRequest<LoadedForm>(`/api/admin/forms/${formId}`)
      .then(form => {
        apply(form);
        setError('');
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load form'))
      .finally(() => setLoading(false));
  }, [formId]);

  const field = schema.fields[selected];
  const scopedLobbies = useMemo(() => {
    if (!divisionId) return lobbies;
    return lobbies.filter(lobby => lobby.divisionId === Number(divisionId));
  }, [divisionId, lobbies]);

  const assignments = () => {
    const owner = divisionId ? Number(divisionId) : null;
    if (!owner) return [];
    const rows: Array<{ divisionId: number; lobbyId: number | null }> = [];
    if (divisionWide) rows.push({ divisionId: owner, lobbyId: null });
    lobbyIds.forEach(lobbyId => rows.push({ divisionId: owner, lobbyId }));
    return rows;
  };

  const payload = () => ({
    name,
    description,
    divisionId: systemWide || !divisionId ? undefined : Number(divisionId),
    systemWide,
    schema,
    assignments: assignments(),
  });

  const save = async () => {
    try {
      parseFormSchema(schema);
      if (!formId) {
        const created = await apiRequest<LoadedForm>('/api/admin/forms', {
          method: 'POST',
          body: JSON.stringify(payload()),
        });
        toast.success('Draft saved');
        router.replace(`/forms/${created.id}`);
        return;
      }
      const updated = await apiRequest<LoadedForm>(`/api/admin/forms/${formId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload()),
      });
      apply(updated);
      toast.success(updated.versionCreated ? 'Saved as a new draft version' : 'Draft saved');
    } catch (cause) {
      const message = cause instanceof FormSchemaError || cause instanceof Error
        ? cause.message
        : 'Save failed';
      toast.error(message);
    }
  };

  const publish = async () => {
    try {
      parseFormSchema(schema);
      let id = formId;
      if (!id) {
        const created = await apiRequest<LoadedForm>('/api/admin/forms', {
          method: 'POST',
          body: JSON.stringify(payload()),
        });
        id = created.id;
      } else {
        const updated = await apiRequest<LoadedForm>(`/api/admin/forms/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload()),
        });
        apply(updated);
      }
      const published = await apiRequest<LoadedForm>(`/api/admin/forms/${id}/publish`, {
        method: 'POST',
      });
      setConfirm(null);
      toast.success('Form published');
      if (!formId) {
        router.replace(`/forms/${id}`);
        return;
      }
      apply(published);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Publish failed');
    }
  };

  const archive = async () => {
    if (!formId) return;
    try {
      const updated = await apiRequest<LoadedForm>(`/api/admin/forms/${formId}/archive`, { method: 'POST' });
      apply(updated);
      setConfirm(null);
      toast.success('Form archived');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Archive failed');
    }
  };

  const newVersion = async () => {
    if (!formId) return;
    try {
      const updated = await apiRequest<LoadedForm>(`/api/admin/forms/${formId}/versions`, {
        method: 'POST',
        body: JSON.stringify({ schema }),
      });
      apply(updated);
      toast.success('New draft version created');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not create a version');
    }
  };

  const updateField = (patch: Partial<FormField>) => {
    setSchema(current => ({
      ...current,
      fields: current.fields.map((item, index) => (index === selected ? { ...item, ...patch } : item)),
    }));
  };

  const moveField = (direction: number) => {
    setSchema(current => {
      const nextIndex = selected + direction;
      if (nextIndex < 0 || nextIndex >= current.fields.length) return current;
      const fields = [...current.fields];
      const [item] = fields.splice(selected, 1);
      fields.splice(nextIndex, 0, item);
      return {
        ...current,
        fields: fields.map((entry, index) => ({ ...entry, displayOrder: index })),
      };
    });
    setSelected(current => current + direction);
  };

  if (loading) {
    return (
      <div className="px-4 lg:px-6">
        <TableSkeleton />
      </div>
    );
  }
  if (error) return <p className="px-4 text-sm text-destructive lg:px-6">{error}</p>;

  const divisionName = divisions.find(item => item.id === Number(divisionId))?.name;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 lg:px-6 xl:overflow-hidden">
      <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Link href="/forms" className="text-xs text-muted-foreground underline">Forms</Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{formId ? name || 'Form' : 'New form'}</h1>
            <StatusPill status={status} />
          </div>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button className="h-9 px-3 text-sm" variant="outline" onClick={() => setPreview(value => !value)}>
              {preview ? 'Edit' : 'Preview'}
            </Button>
            <Button className="h-9 px-3 text-sm" variant="outline" onClick={save}>Save draft</Button>
            <Button className="h-9 px-3 text-sm" onClick={() => setConfirm('publish')}>Publish</Button>
            {formId ? (
              <Button className="h-9 px-3 text-sm" variant="outline" onClick={newVersion}>New version</Button>
            ) : null}
            {formId ? (
              <Button className="h-9 px-3 text-sm" variant="destructive" onClick={() => setConfirm('archive')}>Archive</Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:grid-rows-[minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col gap-4 xl:overflow-y-auto">
          <div className="grid shrink-0 gap-4 rounded-xl border bg-card p-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="form-name">Name</Label>
              <Input id="form-name" className={controlClass} value={name} disabled={!canEdit} onChange={event => setName(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="form-description">Description</Label>
              <Input id="form-description" className={controlClass} value={description} disabled={!canEdit} onChange={event => setDescription(event.target.value)} />
            </div>
            {role === 'SYSTEM_ADMIN' && !formId ? (
              <div className="flex flex-col gap-2 md:col-span-2">
                <label className="flex items-center gap-2 text-sm">
                  <input className="size-4" type="checkbox" checked={systemWide} onChange={event => setSystemWide(event.target.checked)} />
                  System-wide form
                </label>
                {systemWide ? null : (
                  <select aria-label="Division" className={controlClass} value={divisionId} onChange={event => setDivisionId(event.target.value)}>
                    <option value="">Select division</option>
                    {divisions.map(division => (
                      <option key={division.id} value={division.id}>{division.name}</option>
                    ))}
                  </select>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground md:col-span-2">
                {systemWide || !divisionId
                  ? 'Available in every division.'
                  : divisionName
                    ? `Division: ${divisionName}`
                    : 'This form stays in your division.'}
              </p>
            )}
          </div>
          {canEdit && divisionId && !preview ? (
            <div className="shrink-0 rounded-xl border bg-card p-4">
              <h2 className="text-sm font-medium">Assignment</h2>
              <p className="mt-1 text-xs text-muted-foreground">Who in this division can submit the published form.</p>
              <div className="mt-3 flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input className="size-4" type="checkbox" checked={divisionWide} onChange={event => setDivisionWide(event.target.checked)} />
                  Entire division
                </label>
                {scopedLobbies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No lobbies in this division yet.</p>
                ) : scopedLobbies.map(lobby => (
                  <label key={lobby.id} className="flex items-center gap-2 text-sm">
                    <input
                      className="size-4"
                      type="checkbox"
                      checked={lobbyIds.includes(lobby.id)}
                      onChange={event => {
                        setLobbyIds(current => (
                          event.target.checked
                            ? [...current, lobby.id]
                            : current.filter(id => id !== lobby.id)
                        ));
                      }}
                    />
                    {lobby.name}
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          {preview ? (
            <FormFields schema={schema} answers={{}} readOnly />
          ) : (
            <div className="flex min-h-48 flex-1 flex-col rounded-xl border bg-card">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-sm font-medium">Fields</h2>
                {canEdit ? (
                  <Button
                    className="h-8 px-3 text-sm"
                    variant="outline"
                    onClick={() => {
                      const section = schema.sections[0] || 'General';
                      setSchema(current => ({
                        ...current,
                        fields: [...current.fields, blankField(current.fields.length, section)],
                      }));
                      setSelected(schema.fields.length);
                    }}
                  >
                    Add field
                  </Button>
                ) : null}
              </div>
              {schema.fields.length === 0 ? (
                <p className="px-4 py-10 text-sm text-muted-foreground">Add a field to start this form.</p>
              ) : (
                <ul className="min-h-0 flex-1">
                  {schema.fields.map((item, index) => (
                    <li key={item.id} className="border-b last:border-0">
                      <button
                        type="button"
                        className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm ${index === selected ? 'bg-muted' : 'hover:bg-muted/50'}`}
                        onClick={() => setSelected(index)}
                      >
                        <span>
                          <span className="font-medium text-foreground">{item.label}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{item.type} · {item.section}</span>
                        </span>
                        {item.required ? <span className="text-xs text-muted-foreground">Required</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {versions.length > 0 ? (
            <div className="shrink-0 rounded-xl border bg-card p-4">
              <h2 className="text-sm font-medium">Versions</h2>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {versions.map(version => (
                  <li key={version.id}>v{version.versionNumber} · {version.status.toLowerCase()}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <aside className="min-h-0 xl:overflow-y-auto">
          {field && canEdit && !preview ? (
            <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
              <h2 className="text-sm font-medium">Field</h2>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="field-label">Label</Label>
                <Input id="field-label" className={controlClass} value={field.label} onChange={event => updateField({ label: event.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="field-key">Key</Label>
                <Input id="field-key" className={controlClass} value={field.key} onChange={event => updateField({ key: event.target.value.toLowerCase() })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="field-type">Type</Label>
                <select id="field-type" className={controlClass} value={field.type} onChange={event => updateField({ type: event.target.value as FormField['type'] })}>
                  {FIELD_TYPES.map(type => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="field-section">Section</Label>
                <Input id="field-section" className={controlClass} value={field.section} onChange={event => updateField({ section: event.target.value || 'General' })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="field-placeholder">Placeholder</Label>
                <Input id="field-placeholder" className={controlClass} value={field.placeholder} onChange={event => updateField({ placeholder: event.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="field-help">Help text</Label>
                <Input id="field-help" className={controlClass} value={field.helpText} onChange={event => updateField({ helpText: event.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input className="size-4" type="checkbox" checked={field.required} onChange={event => updateField({ required: event.target.checked })} />
                Required
              </label>
              {field.type === 'SINGLE_SELECT' || field.type === 'MULTI_SELECT' || field.type === 'RADIO' ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="field-options">Options, one per line</Label>
                  <textarea
                    id="field-options"
                    className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground dark:border-zinc-600 dark:bg-zinc-950"
                    value={field.options.join('\n')}
                    onChange={event => updateField({
                      options: event.target.value.split('\n').map(option => option.trim()).filter(Boolean),
                    })}
                  />
                </div>
              ) : null}
              {field.type === 'TEXT' || field.type === 'TEXTAREA' || field.type === 'NUMBER' ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="field-min">Min</Label>
                    <Input
                      id="field-min"
                      className={controlClass}
                      value={field.validation.minLength ?? field.validation.min ?? ''}
                      onChange={event => {
                        const number = event.target.value === '' ? undefined : Number(event.target.value);
                        updateField({
                          validation: field.type === 'NUMBER'
                            ? { ...field.validation, min: number }
                            : { ...field.validation, minLength: number },
                        });
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="field-max">Max</Label>
                    <Input
                      id="field-max"
                      className={controlClass}
                      value={field.validation.maxLength ?? field.validation.max ?? ''}
                      onChange={event => {
                        const number = event.target.value === '' ? undefined : Number(event.target.value);
                        updateField({
                          validation: field.type === 'NUMBER'
                            ? { ...field.validation, max: number }
                            : { ...field.validation, maxLength: number },
                        });
                      }}
                    />
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="button" variant="outline" className="h-8 px-3 text-sm" onClick={() => moveField(-1)}>Up</Button>
                <Button type="button" variant="outline" className="h-8 px-3 text-sm" onClick={() => moveField(1)}>Down</Button>
                <Button type="button" variant="destructive" className="h-8 px-3 text-sm" onClick={() => setConfirm('delete')}>Delete</Button>
              </div>
            </div>
          ) : null}
          {canEdit && !preview ? (
            <div className="mt-4 flex gap-2">
              <Input aria-label="New section" className={controlClass} placeholder="New section" value={sectionName} onChange={event => setSectionName(event.target.value)} />
              <Button
                type="button"
                variant="outline"
                className="h-9 px-3 text-sm"
                onClick={() => {
                  const next = sectionName.trim();
                  if (!next) return;
                  setSchema(current => ({
                    ...current,
                    sections: current.sections.includes(next) ? current.sections : [...current.sections, next],
                  }));
                  setSectionName('');
                }}
              >
                Add
              </Button>
            </div>
          ) : null}
        </aside>
      </div>
      <Dialog open={confirm != null} onOpenChange={open => { if (!open) setConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === 'publish' ? 'Publish this version?' : confirm === 'archive' ? 'Archive this form?' : 'Delete this field?'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirm === 'publish'
              ? 'Crew and lobby users will submit this published version.'
              : confirm === 'archive'
                ? 'Archived forms stay in history and cannot be submitted.'
                : 'The field is removed from this draft when you save.'}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            {confirm === 'publish' ? <Button onClick={publish}>Publish</Button> : null}
            {confirm === 'archive' ? <Button variant="destructive" onClick={archive}>Archive</Button> : null}
            {confirm === 'delete' ? (
              <Button
                variant="destructive"
                onClick={() => {
                  setSchema(current => ({
                    ...current,
                    fields: current.fields.filter((_, index) => index !== selected).map((item, index) => ({
                      ...item,
                      displayOrder: index,
                    })),
                  }));
                  setSelected(0);
                  setConfirm(null);
                }}
              >
                Delete
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
