'use client';

import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../administration/api';
import { CallMedia } from './CallMedia';
import { useMonitoringEvents } from './shared';

interface Participant {
  id: number;
  name: string;
  participantType: string;
  status: string;
  userId: number | null;
}

interface CallView {
  id: number;
  lobbyName: string;
  divisionName: string;
  monitorName: string;
  monitorUserId: number;
  status: string;
  uiState: string;
  acceptedAt: string | null;
  participantCount: number;
  participants: Participant[];
  recording: { state: string; activeId: number | null };
}

export function CallStage({ callId }: { callId: number }) {
  const user = useAuthStore(state => state.user);
  const [call, setCall] = useState<CallView | null>(null);

  const load = useCallback(async () => {
    try {
      setCall(await apiRequest<CallView>(`/api/monitoring/calls/${callId}`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load the call.');
    }
  }, [callId]);

  useMonitoringEvents(load);

  const monitor = user?.rmoRole === 'DIVISION_MONITOR' && Number(user.id) === call?.monitorUserId;
  const live = call?.status === 'CONNECTED';
  const recording = call?.recording.state === 'RECORDING';

  async function run(path: string, success: string) {
    try {
      const result = await apiRequest<{ message?: string | null; call?: CallView } | CallView>(path, { method: 'POST' });
      if (result && 'message' in result && result.message) toast.error(result.message);
      else toast.success(success);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Request failed.');
    }
  }

  if (!call) return <p className="p-6 text-sm text-muted-foreground">Loading the call...</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{call.divisionName}</p>
          <h1 className="text-2xl font-semibold">{call.lobbyName}</h1>
        </div>
        <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
          {call.uiState === 'RECONNECTING' ? 'Reconnecting' : call.uiState}
        </span>
      </div>
      <section className="rounded-xl border bg-background p-4 text-sm">
        <p>Connection: {call.uiState === 'RECONNECTING' ? 'Reconnecting' : call.uiState}</p>
        <p>Participants: {call.participantCount}</p>
        <p>Recording: {recording ? 'On' : 'Off'}</p>
        {call.uiState === 'RECONNECTING' ? <p role="status">Connection lost. Reconnecting...</p> : null}
      </section>
      <ul className="space-y-1 text-sm">
        {call.participants.filter(item => item.status === 'JOINED').map(item => (
          <li key={item.id}>{item.name} · {item.participantType.replaceAll('_', ' ').toLowerCase()}</li>
        ))}
      </ul>
      {live && monitor ? (
        <div className="min-h-[28rem] overflow-hidden rounded-xl">
          <CallMedia
            callId={call.id}
            role="monitor"
            peerName={call.lobbyName}
            startedAt={call.acceptedAt}
            recording={recording}
            recordingId={call.recording.activeId}
            canRecord
            onEnd={() => {
              if (window.confirm('End this monitoring call?')) {
                void run(`/api/monitoring/calls/${call.id}/end`, 'Call ended.');
              }
            }}
          />
        </div>
      ) : null}
      {live && user?.rmoRole === 'LOBBY_USER' ? (
        <div className="min-h-[28rem] overflow-hidden rounded-xl">
          <CallMedia
            callId={call.id}
            role="lobby"
            peerName={call.monitorName}
            startedAt={call.acceptedAt}
            onEnd={() => {
              if (window.confirm('End this monitoring call?')) {
                void run(`/api/monitoring/calls/${call.id}/end`, 'Call ended.');
              }
            }}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <Link href="/monitoring">Back to lobbies</Link>
        </Button>
      </div>
    </div>
  );
}
