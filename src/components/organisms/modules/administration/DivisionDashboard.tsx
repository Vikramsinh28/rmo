'use client';

import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiRequest } from './api';

interface Activity {
  id: number;
  action: string;
  createdAt: string;
  actor: { name: string; loginId: string | null } | null;
}

interface Summary {
  division: { name: string; code: string };
  lobbies: number;
  users: number;
  activeUsers: number;
  disabledUsers: number;
  cameras: number;
  kiosks: number;
  health: null;
  activity: Activity[];
}

const LABELS: Record<string, string> = {
  'user.created': 'User created',
  'user.updated': 'User updated',
  'user.enabled': 'User enabled',
  'user.disabled': 'User disabled',
  'user.password_reset': 'Password reset',
  'device.created': 'Device created',
  'device.updated': 'Device updated',
  'device.enabled': 'Device enabled',
  'device.disabled': 'Device disabled',
};

export function DivisionDashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest<Summary>('/api/admin/dashboard')
      .then(setSummary)
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load'));
  }, []);

  if (error) return <p className="px-4 text-sm text-destructive lg:px-6">{error}</p>;
  if (!summary) {
    return (
      <div className="grid gap-4 px-4 md:grid-cols-3 lg:px-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
    );
  }

  const cards = [
    ['Lobbies', summary.lobbies],
    ['Users', summary.users],
    ['Active users', summary.activeUsers],
    ['Disabled users', summary.disabledUsers],
    ['Cameras', summary.cameras],
    ['Kiosks', summary.kiosks],
  ] as const;

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{summary.division.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Division {summary.division.code}. Counts come from this division only.{' '}
          <Link href="/monitoring" className="font-medium text-foreground underline">
            Open live view
          </Link>
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(([label, value]) => (
          <article key={label} className="rounded-xl border bg-card p-5">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
          </article>
        ))}
      </div>
      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-medium">Recent division activity</h2>
          {summary.activity.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No division activity yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {summary.activity.map(item => (
                <li key={item.id} className="flex items-start justify-between gap-3 text-sm">
                  <span>
                    {LABELS[item.action] || item.action}
                    <span className="block text-xs text-muted-foreground">
                      {item.actor?.name || 'System'}
                    </span>
                  </span>
                  <time className="text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </article>
        <article className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-medium">Modules</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Device health is unavailable until a heartbeat source exists. Paid modules cannot be
            turned on from this console.
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            <li>Cameras — included</li>
            <li>Kiosks — included</li>
            <li>Online lobbies — included</li>
            <li>Live session — not enabled</li>
            <li>Face detection — not enabled</li>
            <li>Form submission — not enabled</li>
            <li>AI monitor — not enabled</li>
          </ul>
        </article>
      </section>
    </div>
  );
}
