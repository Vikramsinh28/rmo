'use client';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useEffect, useState } from 'react';
import { apiRequest, StatusBadge } from './api';

interface Activity {
  id: number;
  action: string;
  targetType: string;
  createdAt: string;
  actor: { name: string; loginId: string | null } | null;
}

interface SystemSummary {
  zones: number;
  divisions: number;
  lobbies: number;
  users: number;
  activeUsers: number;
  disabledUsers: number;
  activity: Activity[];
}

const ACTION_LABELS: Record<string, string> = {
  'zone.created': 'Zone created',
  'zone.updated': 'Zone updated',
  'division.created': 'Division created',
  'division.updated': 'Division updated',
  'lobby.created': 'Lobby created',
  'lobby.updated': 'Lobby updated',
  'user.created': 'User created',
  'user.disabled': 'User disabled',
  'user.enabled': 'User enabled',
  'user.role_changed': 'Role changed',
  'user.password_reset': 'Password reset',
  'user.updated': 'User updated',
};

export function AdminDashboard() {
  const [summary, setSummary] = useState<SystemSummary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<SystemSummary>('/api/admin/dashboard')
      .then(setSummary)
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="grid gap-4 px-4 md:grid-cols-3 lg:px-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
    );
  }

  if (error || !summary || typeof summary.zones !== 'number') {
    return <p className="px-4 text-sm text-destructive lg:px-6">{error || 'Dashboard unavailable.'}</p>;
  }

  const cards = [
    ['Zones', summary.zones],
    ['Divisions', summary.divisions],
    ['Lobbies', summary.lobbies],
    ['Users', summary.users],
    ['Active users', summary.activeUsers],
    ['Disabled users', summary.disabledUsers],
  ] as const;

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Organization, access, and recent administrative activity.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(([label, value]) => (
          <article key={label} className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
          </article>
        ))}
      </div>
      <section className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-medium">Recent administrative activity</h2>
          <Button variant="outline" size="sm" onClick={() => (window.location.href = '/audit')}>
            View logs
          </Button>
        </div>
        {summary.activity.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted-foreground">
            No administrative activity yet. Creating a zone, division, lobby, or user will appear
            here.
          </p>
        ) : (
          <ul className="divide-y">
            {summary.activity.map(item => (
              <li key={item.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {ACTION_LABELS[item.action] || item.action}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.actor?.name || 'System'} · {item.targetType}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status="ACTIVE" />
                  <time className="text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString()}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
