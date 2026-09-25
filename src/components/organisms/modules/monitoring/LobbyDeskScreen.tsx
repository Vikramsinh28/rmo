'use client';

import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';
import { Phone, PhoneOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../administration/api';
import { AICapabilityBadge } from './AICapabilityBadge';
import { CallMedia } from './CallMedia';
import { prepareLobbyMedia, stopLobbyMedia } from './lobby-media';
import { useCallRingtone } from './ringtone';
import { useMonitoringEvents } from './shared';

interface DeskLobby {
  id: number;
  name: string;
  divisionName: string;
  presence: 'ONLINE' | 'OFFLINE' | 'CONNECTING';
  call: {
    id: number;
    uiState: string;
    monitorName: string;
    acceptedAt: string | null;
    participantCount: number;
  } | null;
}

interface DeskBoard {
  items: DeskLobby[];
}

interface Participant {
  id: number;
  name: string;
  participantType: string;
  status: string;
  userId: number | null;
}

export function LobbyDeskScreen() {
  const user = useAuthStore(state => state.user);
  const crew = user?.rmoRole === 'CREW_USER';
  const [lobby, setLobby] = useState<DeskLobby | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const board = await apiRequest<DeskBoard>('/api/monitoring/lobbies');
      const next = board.items[0] || null;
      setLobby(next);
      if (next?.call && (next.call.uiState === 'CONNECTED' || next.call.uiState === 'RECONNECTING' || next.call.uiState === 'RINGING')) {
        setParticipants(await apiRequest<Participant[]>(`/api/monitoring/calls/${next.call.id}/participants`));
      } else {
        setParticipants([]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load the lobby.');
    }
  }, []);

  useMonitoringEvents(load);

  useEffect(() => () => stopLobbyMedia(), []);

  useEffect(() => {
    if (crew) return undefined;
    const beat = () => {
      void apiRequest('/api/monitoring/presence', {
        method: 'POST',
        body: JSON.stringify({ presence: 'ONLINE' }),
      }).catch(() => undefined);
    };
    beat();
    const timer = window.setInterval(beat, 20000);
    return () => window.clearInterval(timer);
  }, [crew]);

  async function act(path: string, success: string) {
    setBusy(true);
    try {
      await apiRequest(path, { method: 'POST' });
      toast.success(success);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  const call = lobby?.call;
  const mine = participants.find(item => item.userId === Number(user?.id) && item.status === 'JOINED');
  const ringing = call?.uiState === 'RINGING' && !crew;
  const live = call?.uiState === 'CONNECTED' || call?.uiState === 'RECONNECTING';
  useCallRingtone(Boolean(ringing));

  if (ringing && call && lobby) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 bg-zinc-950 px-6 text-center text-zinc-50">
        <span className="relative flex size-32 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-orange-400/30" />
          <span className="relative flex size-28 items-center justify-center rounded-full bg-orange-500 text-4xl font-semibold">
            {call.monitorName.slice(0, 1)}
          </span>
        </span>
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-orange-200/80">Incoming monitoring call</p>
          <h1 className="mt-3 text-4xl font-semibold">{call.monitorName}</h1>
          <p className="mt-2 text-sm text-zinc-300">{lobby.divisionName} · {lobby.name}</p>
        </div>
        <div className="flex gap-4">
          <button
            type="button"
            disabled={busy}
            aria-label="Reject call"
            onClick={() => act(`/api/monitoring/calls/${call.id}/reject`, 'Call rejected.')}
            className="inline-flex size-16 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
          >
            <PhoneOff className="size-6" />
          </button>
          <button
            type="button"
            disabled={busy}
            aria-label="Accept call"
            onClick={() => {
              setBusy(true);
              void prepareLobbyMedia()
                .catch(() => undefined)
                .then(() => act(`/api/monitoring/calls/${call.id}/accept`, 'Call accepted.'));
            }}
            className="inline-flex size-16 items-center justify-center rounded-full bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-50"
          >
            <Phone className="size-6" />
          </button>
        </div>
        <p className="text-xs text-zinc-400">Accept to open camera and microphone.</p>
      </div>
    );
  }

  if (live && call && lobby && !crew) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <CallMedia
          callId={call.id}
          role="lobby"
          peerName={call.monitorName}
          startedAt={call.acceptedAt}
          onEnd={() => {
            if (window.confirm('End this monitoring call?')) {
              void act(`/api/monitoring/calls/${call.id}/end`, 'Call ended.');
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-zinc-950 p-6 text-zinc-50">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-orange-200/80">Lobby desk</p>
        <h1 className="text-2xl font-semibold">{lobby?.name || 'Lobby'}</h1>
        <p className="text-sm text-zinc-400">{lobby?.divisionName}</p>
      </div>
      <p className="text-sm text-zinc-300">
        {lobby?.presence === 'ONLINE' ? 'Lobby online' : lobby?.presence === 'CONNECTING' ? 'Lobby connecting' : 'Lobby offline'}
      </p>
      {!crew ? <AICapabilityBadge callId={call?.id} /> : null}
      {live && call ? (
        <section className="rounded-xl border border-white/10 p-4">
          <h2 className="text-lg font-semibold">Live with {call.monitorName}</h2>
          <ul className="mt-3 space-y-1 text-sm text-zinc-300">
            {participants.filter(item => item.status === 'JOINED').map(item => (
              <li key={item.id}>{item.name} · {item.participantType.replaceAll('_', ' ').toLowerCase()}</li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2">
            {crew && !mine ? (
              <Button disabled={busy} onClick={() => act(`/api/monitoring/calls/${call.id}/participants`, 'You joined the lobby call.')}>
                Join conversation
              </Button>
            ) : null}
            {crew && mine ? (
              <Button variant="outline" disabled={busy} onClick={() => act(`/api/monitoring/calls/${call.id}/participants/${mine.id}/leave`, 'You left the conversation. The call is still connected.')}>
                Leave conversation
              </Button>
            ) : null}
          </div>
        </section>
      ) : (
        <p className="text-sm text-zinc-400">Waiting for a division monitor to call this lobby.</p>
      )}
    </div>
  );
}
