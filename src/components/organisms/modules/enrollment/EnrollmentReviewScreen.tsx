'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiRequest } from '@/components/organisms/modules/administration/api';
import { FormFields, StatusPill, TableSkeleton } from '@/components/organisms/modules/forms/form-ui';
import type { AnswerMap, FormSchema } from '@/types/form';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface Enrollment {
  id: number;
  publicCode: string;
  fullName: string;
  email: string;
  phone: string;
  employeeId: string;
  staffNumber: string;
  loginId: string;
  status: string;
  createdAt: string;
  rejectionReason: string | null;
  answers: AnswerMap;
  requestedZone: { name: string };
  requestedDivision: { id: number; name: string };
  requestedLobby: { id: number; name: string };
  formVersion: { schema: FormSchema } | null;
  createdUser: { id: number; name: string; rmoRole: string; accountStatus: string } | null;
}

interface Lobby {
  id: number;
  name: string;
}

export function EnrollmentReviewScreen({ enrollmentId }: { enrollmentId: number }) {
  const role = useAuthStore(state => state.user?.rmoRole);
  const [row, setRow] = useState<Enrollment | null>(null);
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [lobbyId, setLobbyId] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const canDecide = role === 'DIVISION_ADMIN';

  const load = () => {
    setLoading(true);
    apiRequest<Enrollment>(`/api/admin/crew-enrollments/${enrollmentId}`)
      .then(result => {
        setRow(result);
        setLobbyId(String(result.requestedLobby.id));
        setError('');
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load enrollment'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [enrollmentId]);

  useEffect(() => {
    if (!canDecide) return;
    apiRequest<{ items: Lobby[] }>('/api/admin/lobbies?pageSize=50')
      .then(result => setLobbies(result.items))
      .catch(() => setLobbies([]));
  }, [canDecide]);

  const approve = async () => {
    try {
      const updated = await apiRequest<Enrollment>(`/api/admin/crew-enrollments/${enrollmentId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ lobbyId: Number(lobbyId) }),
      });
      setRow(updated);
      setMode(null);
      toast.success('Enrollment approved');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Approval failed');
    }
  };

  const reject = async () => {
    if (!reason.trim()) {
      toast.error('A rejection reason is required.');
      return;
    }
    try {
      const updated = await apiRequest<Enrollment>(`/api/admin/crew-enrollments/${enrollmentId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      setRow(updated);
      setMode(null);
      toast.success('Enrollment rejected');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Rejection failed');
    }
  };

  if (loading) return <div className="px-4 lg:px-6"><TableSkeleton /></div>;
  if (error || !row) return <p className="px-4 text-sm text-destructive lg:px-6">{error || 'Enrollment not found'}</p>;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 lg:px-6">
      <div>
        <Link href="/enrollments" className="text-xs text-muted-foreground underline">Crew enrollment</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{row.fullName}</h1>
          <StatusPill status={row.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">RMO-ENR-{row.publicCode}</p>
      </div>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-sm font-medium">Personal information</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <Item label="Email" value={row.email} />
          <Item label="Phone" value={row.phone} />
          <Item label="Employee ID" value={row.employeeId} />
          <Item label="Staff number" value={row.staffNumber} />
          <Item label="Login ID" value={row.loginId} />
          <Item label="Submitted" value={new Date(row.createdAt).toLocaleString()} />
        </dl>
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-sm font-medium">Requested location</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <Item label="Zone" value={row.requestedZone.name} />
          <Item label="Division" value={row.requestedDivision.name} />
          <Item label="Lobby" value={row.requestedLobby.name} />
        </dl>
      </section>
      {row.formVersion ? (
        <section>
          <h2 className="mb-2 text-sm font-medium">Enrollment form answers</h2>
          <FormFields schema={row.formVersion.schema} answers={row.answers || {}} readOnly />
        </section>
      ) : null}
      {row.rejectionReason ? (
        <section className="rounded-xl border bg-card p-4 text-sm">
          <h2 className="font-medium">Rejection reason</h2>
          <p className="mt-2 text-muted-foreground">{row.rejectionReason}</p>
        </section>
      ) : null}
      {row.createdUser ? (
        <section className="rounded-xl border bg-card p-4 text-sm">
          <h2 className="font-medium">Crew account</h2>
          <p className="mt-2">{row.createdUser.name} · {row.createdUser.rmoRole} · {row.createdUser.accountStatus}</p>
          <Link className="mt-2 inline-flex underline" href="/users">Open users</Link>
        </section>
      ) : null}
      {canDecide && row.status === 'PENDING' ? (
        <div className="flex gap-2">
          <Button className="h-9 px-3 text-sm" onClick={() => setMode('approve')}>Approve</Button>
          <Button className="h-9 px-3 text-sm" variant="destructive" onClick={() => setMode('reject')}>Reject</Button>
        </div>
      ) : null}
      <Dialog open={mode === 'approve'} onOpenChange={open => { if (!open) setMode(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve crew enrollment</DialogTitle>
          </DialogHeader>
          <dl className="space-y-2 text-sm">
            <Item label="Applicant" value={row.fullName} />
            <Item label="Requested division" value={row.requestedDivision.name} />
            <Item label="Requested lobby" value={row.requestedLobby.name} />
            <Item label="Final division" value={row.requestedDivision.name} />
            <div>
              <dt className="text-muted-foreground">Final lobby</dt>
              <select aria-label="Final lobby" className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={lobbyId} onChange={event => setLobbyId(event.target.value)}>
                {lobbies.map(lobby => <option key={lobby.id} value={lobby.id}>{lobby.name}</option>)}
              </select>
            </div>
            <Item label="Role" value="CREW_USER" />
            <Item label="Account status" value="ACTIVE" />
          </dl>
          <p className="text-xs text-muted-foreground">The crew member already chose their password. It is not shown or changed here.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)}>Cancel</Button>
            <Button onClick={approve}>Approve enrollment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={mode === 'reject'} onOpenChange={open => { if (!open) setMode(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject crew enrollment</DialogTitle>
          </DialogHeader>
          <label className="text-sm" htmlFor="reject-reason">Reason</label>
          <textarea
            id="reject-reason"
            className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={reason}
            onChange={event => setReason(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)}>Cancel</Button>
            <Button variant="destructive" onClick={reject}>Reject enrollment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
