'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuthStore } from '@/store/auth';
import { PanelLeftClose, PanelLeftOpen, Phone, PhoneOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../administration/api';
import { CallMedia } from './CallMedia';
import { DeskWorkspace } from './DeskWorkspace';
import { useCallRingtone } from './ringtone';
import { useMonitoringEvents } from './shared';

interface LobbyCard {
  id: number;
  name: string;
  divisionName: string;
  zoneName: string;
  status: string;
  presence: 'ONLINE' | 'OFFLINE' | 'CONNECTING';
  room: { status: string } | null;
  call: {
    id: number;
    uiState: string;
    monitorUserId: number;
    monitorName: string;
    acceptedAt: string | null;
    participantCount: number;
    recording: { state: string; activeId: number | null };
  } | null;
}

interface Board {
  items: LobbyCard[];
  summary: {
    lobbies: number;
    activeCalls: number;
    recordingNow: number;
    participants: number;
  };
}

function presenceLabel(presence: LobbyCard['presence']) {
  if (presence === 'ONLINE') return 'Online';
  if (presence === 'CONNECTING') return 'Connecting';
  return 'Offline';
}

export function LobbyMonitorScreen() {
  const user = useAuthStore(state => state.user);
  const readOnly = user?.rmoRole !== 'DIVISION_MONITOR';
  const [board, setBoard] = useState<Board | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ending, setEnding] = useState<LobbyCard | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const collapsedForCall = useRef(false);

  const load = useCallback(async () => {
    try {
      setBoard(await apiRequest<Board>('/api/monitoring/lobbies'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load lobbies.');
    }
  }, []);

  useMonitoringEvents(load);

  async function run(key: string, path: string, method: string, success: string) {
    setBusy(key);
    try {
      const result = await apiRequest<{ message?: string | null }>(path, { method });
      if (result?.message) toast.error(result.message);
      else toast.success(success);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusy(null);
    }
  }

  const items = board?.items || [];
  const owned = items.find(item => (
    item.call
    && item.call.monitorUserId === Number(user?.id)
    && ['RINGING', 'CONNECTED', 'RECONNECTING'].includes(item.call.uiState)
  ));
  const focused = items.find(item => item.id === (owned?.id ?? focusId)) || items[0] || null;
  const call = focused?.call || null;
  const mine = Boolean(call && call.monitorUserId === Number(user?.id));
  const ringing = call?.uiState === 'RINGING' && mine;
  const live = Boolean(call && (call.uiState === 'CONNECTED' || call.uiState === 'RECONNECTING') && mine);
  const recording = call?.recording.state === 'RECORDING';
  useCallRingtone(Boolean(ringing));

  useEffect(() => {
    if ((live || ringing) && !collapsedForCall.current) {
      collapsedForCall.current = true;
      setListOpen(false);
    }
  }, [live, ringing]);

  function chooseLobby(id: number) {
    setFocusId(id);
    setListOpen(false);
  }

  const division = items[0]?.divisionName;
  const title = user?.rmoRole === 'SYSTEM_ADMIN' ? 'All divisions' : division || 'Your division';

  const stage = (
    <>
        {ringing && focused && call ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
            <span className="relative flex size-28 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-orange-400/30" />
              <span className="relative flex size-24 items-center justify-center rounded-full bg-orange-500 text-3xl font-semibold">
                {focused.name.slice(0, 1)}
              </span>
            </span>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-orange-200/80">Calling</p>
              <h2 className="mt-2 text-3xl font-semibold">{focused.name}</h2>
              <p className="mt-2 text-sm text-zinc-300">{focused.divisionName} · waiting for the lobby to answer</p>
            </div>
            <Button
              variant="destructive"
              disabled={busy === `cancel-${call.id}`}
              onClick={() => run(`cancel-${call.id}`, `/api/monitoring/calls/${call.id}/end`, 'POST', 'Call cancelled.')}
            >
              <PhoneOff className="size-4" />
              Cancel call
            </Button>
          </div>
        ) : null}
        {live && focused && call ? (
          <CallMedia
            callId={call.id}
            role="monitor"
            peerName={focused.name}
            startedAt={call.acceptedAt}
            recording={recording}
            recordingId={call.recording.activeId}
            canRecord={!readOnly}
            onEnd={readOnly ? undefined : () => setEnding(focused)}
          />
        ) : null}
        {!ringing && !live && focused ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-xs uppercase tracking-[0.2em] text-orange-200/80">{focused.divisionName}</p>
            <h2 className="text-3xl font-semibold">{focused.name}</h2>
            <p className="text-sm text-zinc-400">
              {presenceLabel(focused.presence)}.
              {' '}
              {focused.call ? `Call ${focused.call.uiState.toLowerCase()}.` : 'Ready for a monitoring call.'}
            </p>
            {!readOnly && !focused.call && focused.status === 'ACTIVE' && focused.room?.status === 'ACTIVE' ? (
              <Button
                disabled={busy === `call-${focused.id}`}
                onClick={() => {
                  chooseLobby(focused.id);
                  void run(`call-${focused.id}`, `/api/monitoring/lobbies/${focused.id}/call`, 'POST', 'Calling the lobby.');
                }}
              >
                <Phone className="size-4" />
                Call lobby
              </Button>
            ) : null}
          </div>
        ) : null}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 bg-zinc-950 text-zinc-50">
      {listOpen ? (
        <aside className="flex w-80 shrink-0 flex-col border-r border-white/10">
          <div className="border-b border-white/10 px-4 py-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-orange-200/80">Live</p>
                <h1 className="text-lg font-semibold">{title}</h1>
              </div>
              <button
                type="button"
                aria-label="Hide lobby list"
                title="Hide lobby list"
                onClick={() => setListOpen(false)}
                className="rounded-md p-1 text-zinc-300 hover:bg-white/10"
              >
                <PanelLeftClose className="size-4" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <MiniStat label="Lobbies" value={board?.summary.lobbies ?? '—'} />
              <MiniStat label="Calls" value={board?.summary.activeCalls ?? '—'} />
              <MiniStat label="Rec" value={board?.summary.recordingNow ?? '—'} />
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {items.map(lobby => {
              const selected = lobby.id === focused?.id;
              const state = lobby.call?.uiState;
              return (
                <button
                  key={lobby.id}
                  type="button"
                  onClick={() => chooseLobby(lobby.id)}
                  className={`w-full rounded-xl border px-3 py-3 text-left ${selected ? 'border-orange-300/60 bg-white/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium">{lobby.name}</p>
                    {state === 'CONNECTED' || state === 'RECONNECTING' ? (
                      <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold">LIVE</span>
                    ) : null}
                    {state === 'RINGING' ? (
                      <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-semibold">RINGING</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">
                    {presenceLabel(lobby.presence)}
                    {lobby.call ? ` · ${lobby.call.participantCount} on the call` : ''}
                  </p>
                </button>
              );
            })}
            {!board ? <p className="px-1 text-sm text-zinc-400">Loading lobbies...</p> : null}
            {board && items.length === 0 ? (
              <p className="px-1 text-sm text-zinc-400">No lobbies are available in your scope.</p>
            ) : null}
          </div>
        </aside>
      ) : (
        <aside className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-white/10 py-3">
          <button
            type="button"
            aria-label="Show lobby list"
            title="Show lobby list"
            onClick={() => setListOpen(true)}
            className="rounded-md p-2 text-zinc-200 hover:bg-white/10"
          >
            <PanelLeftOpen className="size-4" />
          </button>
          <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto">
            {items.map(lobby => {
              const selected = lobby.id === focused?.id;
              const liveLobby = lobby.call?.uiState === 'CONNECTED' || lobby.call?.uiState === 'RECONNECTING';
              return (
                <button
                  key={lobby.id}
                  type="button"
                  title={lobby.name}
                  aria-label={lobby.name}
                  onClick={() => chooseLobby(lobby.id)}
                  className={`relative flex size-9 items-center justify-center rounded-full text-xs font-semibold ${selected ? 'bg-orange-500 text-white' : 'bg-white/10 text-zinc-100 hover:bg-white/20'}`}
                >
                  {lobby.name.slice(0, 1)}
                  {liveLobby ? <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-red-500" /> : null}
                </button>
              );
            })}
          </div>
        </aside>
      )}
      {focused ? (
        <DeskWorkspace lobbyId={focused.id} lobbyName={focused.name}>
          <div className="flex min-h-0 flex-1 flex-col">{stage}</div>
        </DeskWorkspace>
      ) : (
        <p className="p-6 text-sm text-zinc-400">Select a lobby to open the desk.</p>
      )}
      <Dialog open={Boolean(ending)} onOpenChange={open => { if (!open) setEnding(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End the call with {ending?.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">The lobby room stays in place. This only ends the current call.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnding(null)}>Keep the call</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!ending?.call) return;
                await run(`end-${ending.call.id}`, `/api/monitoring/calls/${ending.call.id}/end`, 'POST', 'Call ended.');
                setEnding(null);
              }}
            >
              End call
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-2">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
    </div>
  );
}
