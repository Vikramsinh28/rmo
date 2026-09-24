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
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest, StatusBadge } from './api';

interface Lobby {
  id: number;
  name: string;
}

interface Device {
  id: number;
  name: string;
  deviceType: 'CAMERA' | 'KIOSK';
  lobbyId: number;
  streamUrl: string;
  displayOrder: number;
  isActive: boolean;
  lobby: { id: number; name: string; division: { name: string } };
}

interface Page<T> {
  items: T[];
  total: number;
}

const EMPTY = {
  name: '',
  deviceType: 'CAMERA' as 'CAMERA' | 'KIOSK',
  lobbyId: '',
  streamUrl: '',
  displayOrder: '0',
};

export function DeviceScreen({ initialType }: { initialType?: string }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lobbyId, setLobbyId] = useState('');
  const [deviceType, setDeviceType] = useState(initialType === 'KIOSK' ? 'KIOSK' : initialType === 'CAMERA' ? 'CAMERA' : '');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);
  const [form, setForm] = useState(EMPTY);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ pageSize: '50' });
    if (lobbyId) params.set('lobbyId', lobbyId);
    if (deviceType) params.set('deviceType', deviceType);
    if (status) params.set('status', status);
    apiRequest<Page<Device>>(`/api/admin/devices?${params.toString()}`)
      .then(result => setDevices(result.items))
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobbyId, deviceType, status]);

  useEffect(() => {
    apiRequest<Page<Lobby>>('/api/admin/lobbies?pageSize=50')
      .then(result => setLobbies(result.items))
      .catch(() => setLobbies([]));
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, Device[]>();
    devices.forEach(device => {
      const key = device.lobby.name;
      map.set(key, [...(map.get(key) || []), device]);
    });
    return [...map.entries()];
  }, [devices]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      name: form.name,
      deviceType: form.deviceType,
      lobbyId: Number(form.lobbyId),
      streamUrl: form.streamUrl,
      displayOrder: Number(form.displayOrder || 0),
    };
    try {
      if (editing) {
        await apiRequest(`/api/admin/devices/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        toast.success('Device updated');
      } else {
        await apiRequest('/api/admin/devices', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success('Device created');
      }
      setOpen(false);
      load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Save failed');
    }
  };

  const setActive = async (device: Device, isActive: boolean) => {
    try {
      await apiRequest(`/api/admin/devices/${device.id}/${isActive ? 'enable' : 'disable'}`, {
        method: 'POST',
      });
      toast.success(isActive ? 'Device enabled' : 'Device disabled');
      load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Update failed');
    }
  };

  const openCreate = (type: 'CAMERA' | 'KIOSK') => {
    setEditing(null);
    setForm({ ...EMPTY, deviceType: type });
    setOpen(true);
  };

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Devices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cameras and kiosks stay inside this division. Health is shown only when a source exists.
          </p>
        </div>
        <div className="flex gap-2">
          <Button className="h-9" onClick={() => openCreate('CAMERA')}>Add camera</Button>
          <Button className="h-9" variant="outline" onClick={() => openCreate('KIOSK')}>Add kiosk</Button>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        <select aria-label="Lobby" className="h-9 rounded-md border bg-background px-3 text-sm" value={lobbyId} onChange={event => setLobbyId(event.target.value)}>
          <option value="">All lobbies</option>
          {lobbies.map(lobby => <option key={lobby.id} value={lobby.id}>{lobby.name}</option>)}
        </select>
        <select aria-label="Device type" className="h-9 rounded-md border bg-background px-3 text-sm" value={deviceType} onChange={event => setDeviceType(event.target.value)}>
          <option value="">All types</option>
          <option value="CAMERA">Camera</option>
          <option value="KIOSK">Kiosk</option>
        </select>
        <select aria-label="Configuration status" className="h-9 rounded-md border bg-background px-3 text-sm" value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">All configuration</option>
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
        </select>
        <select aria-label="Health status" className="h-9 rounded-md border bg-background px-3 text-sm" defaultValue="unavailable" disabled>
          <option value="unavailable">Health unavailable</option>
        </select>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading devices…</p> : null}
      {!loading && groups.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-10 text-sm text-muted-foreground">
          No devices match this view.
        </p>
      ) : null}
      {groups.map(([lobbyName, rows]) => (
        <section key={lobbyName} className="overflow-hidden rounded-xl border bg-card">
          <h2 className="border-b px-4 py-3 text-sm font-medium">{lobbyName}</h2>
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Device name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Configuration</th>
                <th className="px-4 py-3 font-medium">Health</th>
                <th className="px-4 py-3 font-medium">Last seen</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(device => (
                <tr key={device.id} className="border-t">
                  <td className="px-4 py-3">
                    <div className="font-medium">{device.name}</div>
                    <div className="text-xs text-muted-foreground">Order {device.displayOrder}</div>
                  </td>
                  <td className="px-4 py-3">{device.deviceType === 'CAMERA' ? 'Camera' : 'Kiosk'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={device.isActive ? 'ACTIVE' : 'DISABLED'} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">Health unavailable</td>
                  <td className="px-4 py-3 text-muted-foreground">—</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="h-8"
                        onClick={() => {
                          setEditing(device);
                          setForm({
                            name: device.name,
                            deviceType: device.deviceType,
                            lobbyId: String(device.lobbyId),
                            streamUrl: device.streamUrl,
                            displayOrder: String(device.displayOrder),
                          });
                          setOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button variant="outline" className="h-8" onClick={() => setActive(device, !device.isActive)}>
                        {device.isActive ? 'Disable' : 'Enable'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit device' : form.deviceType === 'KIOSK' ? 'Add kiosk' : 'Add camera'}</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={save}>
            <div className="space-y-2">
              <Label htmlFor="device-name">Name</Label>
              <Input id="device-name" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.deviceType} onChange={event => setForm(current => ({ ...current, deviceType: event.target.value as 'CAMERA' | 'KIOSK' }))}>
                <option value="CAMERA">Camera</option>
                <option value="KIOSK">Kiosk</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Lobby</Label>
              <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.lobbyId} onChange={event => setForm(current => ({ ...current, lobbyId: event.target.value }))} required>
                <option value="">Select lobby</option>
                {lobbies.map(lobby => <option key={lobby.id} value={lobby.id}>{lobby.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="device-url">Stream URL</Label>
              <Input id="device-url" value={form.streamUrl} onChange={event => setForm(current => ({ ...current, streamUrl: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="device-order">Display order</Label>
              <Input id="device-order" type="number" value={form.displayOrder} onChange={event => setForm(current => ({ ...current, displayOrder: event.target.value }))} />
            </div>
            <DialogFooter>
              <Button type="submit" className="h-9">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
