'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RMO_ROLES, locationRequirement, type RmoRoleName } from '@/lib/rmo/access';
import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest, StatusBadge } from './api';

interface Location {
  id: number;
  name: string;
  code: string;
  zoneId?: number;
  divisionId?: number;
}

interface UserRow {
  id: number;
  name: string;
  email: string;
  loginId: string | null;
  rmoRole: RmoRoleName;
  accountStatus: string;
  homeZoneId: number | null;
  homeDivisionId: number | null;
  homeLobbyId: number | null;
  homeZone?: { name: string } | null;
  homeDivision?: { name: string } | null;
  homeLobby?: { name: string } | null;
  lastLoginAt?: string | null;
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const EMPTY = {
  name: '',
  email: '',
  loginId: '',
  password: '',
  rmoRole: 'CREW_USER' as RmoRoleName,
  homeZoneId: '',
  homeDivisionId: '',
  homeLobbyId: '',
};

const MANAGED_ROLES: readonly RmoRoleName[] = ['DIVISION_MONITOR', 'LOBBY_USER', 'CREW_USER'];

export function UserScreen({
  canWrite,
  actorRole = 'SYSTEM_ADMIN',
  homeZoneId,
  homeDivisionId,
}: {
  canWrite: boolean;
  actorRole?: 'SYSTEM_ADMIN' | 'DIVISION_ADMIN';
  homeZoneId?: number | null;
  homeDivisionId?: number | null;
}) {
  const [page, setPage] = useState<Page<UserRow> | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [zones, setZones] = useState<Location[]>([]);
  const [divisions, setDivisions] = useState<Location[]>([]);
  const [lobbies, setLobbies] = useState<Location[]>([]);
  const [confirmDisable, setConfirmDisable] = useState<UserRow | null>(null);
  const [viewing, setViewing] = useState<UserRow | null>(null);
  const assignableRoles = actorRole === 'DIVISION_ADMIN' ? MANAGED_ROLES : RMO_ROLES;
  const lockedDivision = actorRole === 'DIVISION_ADMIN';

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(currentPage), pageSize: '10' });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (role) params.set('role', role);
    apiRequest<Page<UserRow>>(`/api/admin/users?${params.toString()}`)
      .then(setPage)
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, status, role]);

  useEffect(() => {
    if (!canWrite || lockedDivision) return;
    apiRequest<Page<Location>>('/api/admin/zones?pageSize=50')
      .then(result => setZones(result.items))
      .catch(() => setZones([]));
  }, [canWrite, lockedDivision]);

  useEffect(() => {
    if (!form.homeZoneId) {
      setDivisions([]);
      return;
    }
    apiRequest<Page<Location>>(`/api/admin/divisions?zoneId=${form.homeZoneId}&pageSize=50`)
      .then(result => setDivisions(result.items))
      .catch(() => setDivisions([]));
  }, [form.homeZoneId]);

  useEffect(() => {
    if (!form.homeDivisionId) {
      setLobbies([]);
      return;
    }
    apiRequest<Page<Location>>(`/api/admin/lobbies?divisionId=${form.homeDivisionId}&pageSize=50`)
      .then(result => setLobbies(result.items))
      .catch(() => setLobbies([]));
  }, [form.homeDivisionId]);

  const requirement = locationRequirement(form.rmoRole);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const payload: Record<string, unknown> = {
      name: form.name,
      email: form.email,
      loginId: form.loginId,
      rmoRole: form.rmoRole,
      homeZoneId: requirement === 'none' ? null : Number(form.homeZoneId),
      homeDivisionId: requirement === 'none' ? null : Number(form.homeDivisionId),
      homeLobbyId: requirement === 'lobby' ? Number(form.homeLobbyId) : null,
    };
    if (!editing && form.password) payload.password = form.password;
    try {
      if (editing) {
        await apiRequest(`/api/admin/users/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        if (form.password) {
          await apiRequest(`/api/admin/users/${editing.id}/password`, {
            method: 'POST',
            body: JSON.stringify({ password: form.password }),
          });
        }
        toast.success('User updated');
      } else {
        await apiRequest('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({ ...payload, password: form.password }),
        });
        toast.success('User created');
      }
      setOpen(false);
      load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Save failed');
    }
  };

  const setStatusFor = async (row: UserRow, accountStatus: 'ACTIVE' | 'DISABLED') => {
    try {
      await apiRequest(`/api/admin/users/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ accountStatus }),
      });
      toast.success(accountStatus === 'DISABLED' ? 'User disabled' : 'User enabled');
      setConfirmDisable(null);
      load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Update failed');
    }
  };

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Assign a role and only the location that role requires.
          </p>
        </div>
        {canWrite ? (
          <Button
            className="h-9 text-sm"
            onClick={() => {
              setEditing(null);
              setForm({
                ...EMPTY,
                rmoRole: assignableRoles[0],
                homeZoneId: homeZoneId ? String(homeZoneId) : '',
                homeDivisionId: homeDivisionId ? String(homeDivisionId) : '',
              });
              setOpen(true);
            }}
          >
            Create user
          </Button>
        ) : null}
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        <Input
          aria-label="Search users"
          placeholder="Search name, user ID, or email"
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
        <select
          aria-label="Role filter"
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={role}
          onChange={event => {
            setRole(event.target.value);
            setCurrentPage(1);
          }}
        >
          <option value="">All roles</option>
          {RMO_ROLES.map(item => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          aria-label="Status filter"
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={status}
          onChange={event => {
            setStatus(event.target.value);
            setCurrentPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
        </select>
        <Button className="h-9" variant="outline" onClick={() => { setCurrentPage(1); load(); }}>
          Search
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="overflow-x-auto rounded-xl border bg-card">
        {loading ? (
          <div className="space-y-3 px-4 py-6">
            <div className="h-8 animate-pulse rounded-md bg-muted" />
            <div className="h-8 animate-pulse rounded-md bg-muted" />
            <div className="h-8 animate-pulse rounded-md bg-muted" />
          </div>
        ) : page && page.items.length === 0 ? (
          <p className="px-4 py-10 text-sm text-muted-foreground">No users match this view.</p>
        ) : (
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">User ID</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Zone</th>
                <th className="px-4 py-3 font-medium">Division</th>
                <th className="px-4 py-3 font-medium">Lobby</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last login</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {page?.items.map(row => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-muted-foreground">{row.email}</div>
                  </td>
                  <td className="px-4 py-3">{row.loginId || '—'}</td>
                  <td className="px-4 py-3">{row.rmoRole}</td>
                  <td className="px-4 py-3">{row.homeZone?.name || '—'}</td>
                  <td className="px-4 py-3">{row.homeDivision?.name || '—'}</td>
                  <td className="px-4 py-3">{row.homeLobby?.name || '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.accountStatus} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" className="h-8" onClick={() => setViewing(row)}>
                        View
                      </Button>
                      {canWrite ? (
                        <>
                          <Button
                            variant="outline"
                            className="h-8"
                            onClick={() => {
                              setEditing(row);
                              setForm({
                                name: row.name,
                                email: row.email,
                                loginId: row.loginId || '',
                                password: '',
                                rmoRole: row.rmoRole,
                                homeZoneId: row.homeZoneId ? String(row.homeZoneId) : '',
                                homeDivisionId: row.homeDivisionId ? String(row.homeDivisionId) : '',
                                homeLobbyId: row.homeLobbyId ? String(row.homeLobbyId) : '',
                              });
                              setOpen(true);
                            }}
                          >
                            Edit
                          </Button>
                          {row.accountStatus === 'ACTIVE' ? (
                            <Button
                              variant="outline"
                              className="h-8"
                              onClick={() => setConfirmDisable(row)}
                            >
                              Disable
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              className="h-8"
                              onClick={() => setStatusFor(row, 'ACTIVE')}
                            >
                              Enable
                            </Button>
                          )}
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" className="h-8" disabled={currentPage <= 1} onClick={() => setCurrentPage(value => value - 1)}>
          Previous
        </Button>
        <Button
          variant="outline"
          className="h-8"
          disabled={!page || currentPage * page.pageSize >= page.total}
          onClick={() => setCurrentPage(value => value + 1)}
        >
          Next
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit user' : 'Create user'}</DialogTitle>
            <DialogDescription>
              Location fields follow the selected role. Passwords are stored as a hash.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={save}>
            <div className="space-y-2">
              <Label htmlFor="user-name">Name</Label>
              <Input id="user-name" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-login">User ID</Label>
              <Input id="user-login" value={form.loginId} onChange={event => setForm(current => ({ ...current, loginId: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-email">Email</Label>
              <Input id="user-email" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-role">Role</Label>
              <select
                id="user-role"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={form.rmoRole}
                onChange={event => setForm(current => ({ ...current, rmoRole: event.target.value as RmoRoleName }))}
              >
                {assignableRoles.map(item => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
            {requirement !== 'none' && !lockedDivision ? (
              <>
                <div className="space-y-2">
                  <Label>Zone</Label>
                  <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.homeZoneId} onChange={event => setForm(current => ({ ...current, homeZoneId: event.target.value, homeDivisionId: '', homeLobbyId: '' }))} required>
                    <option value="">Select zone</option>
                    {zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Division</Label>
                  <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.homeDivisionId} onChange={event => setForm(current => ({ ...current, homeDivisionId: event.target.value, homeLobbyId: '' }))} required>
                    <option value="">Select division</option>
                    {divisions.map(division => <option key={division.id} value={division.id}>{division.name}</option>)}
                  </select>
                </div>
              </>
            ) : null}
            {requirement !== 'none' && lockedDivision ? (
              <p className="text-sm text-muted-foreground">
                This account stays in your assigned division.
              </p>
            ) : null}
            {requirement === 'lobby' ? (
              <div className="space-y-2">
                <Label>Lobby</Label>
                <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.homeLobbyId} onChange={event => setForm(current => ({ ...current, homeLobbyId: event.target.value }))} required>
                  <option value="">Select lobby</option>
                  {lobbies.map(lobby => <option key={lobby.id} value={lobby.id}>{lobby.name}</option>)}
                </select>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="user-password">{editing ? 'Reset password' : 'Password'}</Label>
              <Input id="user-password" type="password" value={form.password} onChange={event => setForm(current => ({ ...current, password: event.target.value }))} required={!editing} autoComplete="new-password" />
              <p className="text-xs text-muted-foreground">
                At least 8 characters, with upper, lower, a number, and a symbol.
              </p>
            </div>
            <DialogFooter>
              <Button type="submit" className="h-9">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(viewing)} onOpenChange={openState => !openState && setViewing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{viewing?.name}</DialogTitle>
            <DialogDescription>{viewing?.email}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">User ID</dt>
              <dd>{viewing?.loginId || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Role</dt>
              <dd>{viewing?.rmoRole}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Zone</dt>
              <dd>{viewing?.homeZone?.name || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Division</dt>
              <dd>{viewing?.homeDivision?.name || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Lobby</dt>
              <dd>{viewing?.homeLobby?.name || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last login</dt>
              <dd>{viewing?.lastLoginAt ? new Date(viewing.lastLoginAt).toLocaleString() : 'Never'}</dd>
            </div>
          </dl>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmDisable)} onOpenChange={openState => !openState && setConfirmDisable(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable {confirmDisable?.name}?</DialogTitle>
            <DialogDescription>
              Disabled users cannot sign in or call protected APIs. The account is kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDisable(null)}>Cancel</Button>
            <Button onClick={() => confirmDisable && setStatusFor(confirmDisable, 'DISABLED')}>
              Disable user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
