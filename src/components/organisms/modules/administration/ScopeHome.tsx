'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from './api';

interface Profile {
  name: string;
  email: string;
  loginId: string | null;
  rmoRole: string;
  scope: string;
  accountStatus: string;
  homeZone: { name: string; code: string } | null;
  homeDivision: { name: string; code: string } | null;
  homeLobby: { name: string; code: string } | null;
}

export function ScopeHome({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest<Profile>('/api/auth/me')
      .then(setProfile)
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load'));
  }, []);

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!profile && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {profile ? (
        <article className="max-w-xl rounded-xl border bg-card p-5">
          <p className="text-lg font-medium">{profile.name}</p>
          <p className="text-sm text-muted-foreground">{profile.loginId || profile.email}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Role</dt>
              <dd>{profile.rmoRole}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Scope</dt>
              <dd>{profile.scope}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Zone</dt>
              <dd>{profile.homeZone?.name || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Division</dt>
              <dd>{profile.homeDivision?.name || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Lobby</dt>
              <dd>{profile.homeLobby?.name || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd>{profile.accountStatus}</dd>
            </div>
          </dl>
        </article>
      ) : null}
    </div>
  );
}
