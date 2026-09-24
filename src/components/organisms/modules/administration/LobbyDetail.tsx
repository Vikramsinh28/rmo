'use client';

import { StatusBadge, apiRequest } from '@/components/organisms/modules/administration/api';
import { useEffect, useState } from 'react';

interface Lobby {
  id: number;
  name: string;
  code: string;
  status: string;
  division: { id: number; name: string; code: string };
}

interface UserRow {
  id: number;
  name: string;
  loginId: string | null;
  rmoRole: string;
  accountStatus: string;
}

interface Device {
  id: number;
  name: string;
  deviceType: string;
  isActive: boolean;
  displayOrder: number;
}

export function LobbyDetail({ lobbyId }: { lobbyId: number }) {
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest<Lobby>(`/api/admin/lobbies/${lobbyId}`)
      .then(setLobby)
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load'));
    apiRequest<{ items: UserRow[] }>(`/api/admin/users?lobbyId=${lobbyId}&pageSize=50`)
      .then(result => setUsers(result.items))
      .catch(() => setUsers([]));
    apiRequest<{ items: Device[] }>(`/api/admin/devices?lobbyId=${lobbyId}&pageSize=50`)
      .then(result => setDevices(result.items))
      .catch(() => setDevices([]));
  }, [lobbyId]);

  if (error) return <p className="px-4 text-sm text-destructive lg:px-6">{error}</p>;
  if (!lobby) return <p className="px-4 text-sm text-muted-foreground lg:px-6">Loading lobby…</p>;

  const cameras = devices.filter(device => device.deviceType === 'CAMERA');
  const kiosks = devices.filter(device => device.deviceType === 'KIOSK');

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6">
      <div>
        <p className="text-sm text-muted-foreground">{lobby.division.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{lobby.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Code {lobby.code}. The parent division can be changed only by a system admin.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-medium">Lobby</h2>
          <p className="mt-3 text-sm"><StatusBadge status={lobby.status} /></p>
        </article>
        <article className="rounded-xl border bg-card p-5 lg:col-span-2">
          <h2 className="text-sm font-medium">Users</h2>
          {users.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No users assigned.</p> : (
            <ul className="mt-3 space-y-2 text-sm">
              {users.map(user => (
                <li key={user.id} className="flex justify-between gap-3">
                  <span>{user.name} <span className="text-muted-foreground">{user.loginId}</span></span>
                  <span className="text-muted-foreground">{user.rmoRole}</span>
                </li>
              ))}
            </ul>
          )}
        </article>
        <article className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-medium">Cameras</h2>
          <DeviceList devices={cameras} />
        </article>
        <article className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-medium">Kiosks</h2>
          <DeviceList devices={kiosks} />
        </article>
        <article className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-medium">Device health</h2>
          <p className="mt-3 text-sm text-muted-foreground">Health unavailable</p>
        </article>
      </div>
    </div>
  );
}

function DeviceList({ devices }: { devices: Device[] }) {
  if (devices.length === 0) return <p className="mt-3 text-sm text-muted-foreground">None configured.</p>;
  return (
    <ul className="mt-3 space-y-2 text-sm">
      {devices.map(device => (
        <li key={device.id}>
          {device.name}
          <span className="block text-xs text-muted-foreground">
            {device.isActive ? 'Active' : 'Disabled'} · Health unavailable
          </span>
        </li>
      ))}
    </ul>
  );
}
