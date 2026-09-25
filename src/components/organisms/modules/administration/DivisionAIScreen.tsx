'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest, StatusBadge } from './api';

interface FeatureSet {
  faceIdentification: boolean;
  fatigueDetection: boolean;
  impairmentDetection: boolean;
  behaviorMonitoring: boolean;
}

interface AIPage {
  division: {
    id: number;
    name: string;
    code: string;
    status: string;
    zone: { id: number; name: string; code: string };
  };
  entitlement: {
    id: number;
    enabled: boolean;
    plan: string;
    status: string;
    startsAt: string | null;
    expiresAt: string | null;
    features: FeatureSet;
    updatedAt: string;
  } | null;
  capabilities: {
    available: boolean;
    reason: string | null;
    moduleNote: string;
    features: FeatureSet;
  };
}

const FEATURES: { key: keyof FeatureSet; title: string; description: string }[] = [
  {
    key: 'faceIdentification',
    title: 'Face Identification',
    description: 'Identify registered crew members in live sessions.',
  },
  {
    key: 'fatigueDetection',
    title: 'Fatigue Detection',
    description: 'Detect potential fatigue indicators during live sessions.',
  },
  {
    key: 'impairmentDetection',
    title: 'Potential Impairment',
    description: 'Detect potential behavioral indicators requiring human review.',
  },
  {
    key: 'behaviorMonitoring',
    title: 'Behavior Monitoring',
    description: 'Detect configured behavioral and safety indicators.',
  },
];

function toInputDate(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function DivisionAIScreen({ divisionId }: { divisionId: number }) {
  const role = useAuthStore(state => state.user?.rmoRole);
  const canWrite = role === 'SYSTEM_ADMIN';
  const [page, setPage] = useState<AIPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    enabled: false,
    plan: 'BASIC',
    status: 'INACTIVE',
    startsAt: '',
    expiresAt: '',
    features: {
      faceIdentification: false,
      fatigueDetection: false,
      impairmentDetection: false,
      behaviorMonitoring: false,
    } as FeatureSet,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest<AIPage>(`/api/admin/divisions/${divisionId}/ai`);
      setPage(data);
      setForm({
        enabled: data.entitlement?.enabled ?? false,
        plan: data.entitlement?.plan ?? 'BASIC',
        status: data.entitlement?.status ?? 'INACTIVE',
        startsAt: toInputDate(data.entitlement?.startsAt),
        expiresAt: toInputDate(data.entitlement?.expiresAt),
        features: data.entitlement?.features ?? {
          faceIdentification: false,
          fatigueDetection: false,
          impairmentDetection: false,
          behaviorMonitoring: false,
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load AI settings.');
    } finally {
      setLoading(false);
    }
  }, [divisionId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) return;
    setSaving(true);
    try {
      const data = await apiRequest<AIPage>(`/api/admin/divisions/${divisionId}/ai`, {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: form.enabled,
          plan: form.plan,
          status: form.status,
          startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
          features: form.features,
        }),
      });
      setPage(data);
      toast.success('AI monitoring settings saved.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save AI settings.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-56" />
      </div>
    );
  }

  if (!page) {
    return <p className="p-6 text-sm text-muted-foreground">AI monitoring settings are unavailable.</p>;
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-orange-600/80">
            AI Monitoring
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{page.division.name} Division</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {page.division.zone.name} · {page.division.code}
            {' · '}
            {page.capabilities.available ? 'Available now' : page.capabilities.reason}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/divisions">Back to divisions</Link>
        </Button>
      </div>

      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Entitlement</h2>
            <p className="text-sm text-muted-foreground">
              Division-level paid capability. Live video continues whether AI is on or off.
            </p>
          </div>
          <StatusBadge status={page.capabilities.available ? 'ACTIVE' : 'DISABLED'} />
        </div>
        <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={save}>
          <label className="flex items-center justify-between rounded-xl border px-4 py-3 md:col-span-2">
            <div>
              <p className="text-sm font-medium">AI monitoring enabled</p>
              <p className="text-xs text-muted-foreground">Master switch for this division.</p>
            </div>
            <Switch
              checked={form.enabled}
              disabled={!canWrite || saving}
              onCheckedChange={value => setForm(current => ({ ...current, enabled: value }))}
            />
          </label>
          <div className="space-y-2">
            <Label htmlFor="ai-plan">Plan</Label>
            <select
              id="ai-plan"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.plan}
              disabled={!canWrite || saving}
              onChange={event => setForm(current => ({ ...current, plan: event.target.value }))}
            >
              <option value="BASIC">Basic</option>
              <option value="PREMIUM">Premium</option>
              <option value="ENTERPRISE">Enterprise</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-status">Status</Label>
            <select
              id="ai-status"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.status}
              disabled={!canWrite || saving}
              onChange={event => setForm(current => ({ ...current, status: event.target.value }))}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-start">Start</Label>
            <Input
              id="ai-start"
              type="datetime-local"
              value={form.startsAt}
              disabled={!canWrite || saving}
              onChange={event => setForm(current => ({ ...current, startsAt: event.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-end">Expiry</Label>
            <Input
              id="ai-end"
              type="datetime-local"
              value={form.expiresAt}
              disabled={!canWrite || saving}
              onChange={event => setForm(current => ({ ...current, expiresAt: event.target.value }))}
            />
          </div>
          <section className="grid gap-4 md:col-span-2 md:grid-cols-2">
            {FEATURES.map(feature => (
              <article key={feature.key} className="rounded-2xl border bg-background p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{feature.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                  <Switch
                    checked={form.features[feature.key]}
                    disabled={!canWrite || saving}
                    onCheckedChange={value => setForm(current => ({
                      ...current,
                      features: { ...current.features, [feature.key]: value },
                    }))}
                  />
                </div>
                <p className="mt-4 text-xs font-medium text-orange-700/90">
                  {form.features[feature.key]
                    ? page.capabilities.moduleNote
                    : 'Feature entitlement is off for this division.'}
                </p>
              </article>
            ))}
          </section>
          {canWrite ? (
            <div className="md:col-span-2">
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save entitlement'}
              </Button>
            </div>
          ) : (
            <p className="md:col-span-2 text-sm text-muted-foreground">
              Only a system admin can change AI entitlement for a division.
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
