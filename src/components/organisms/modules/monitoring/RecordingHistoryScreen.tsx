'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../administration/api';
import { formatDuration, formatWhen, useMonitoringEvents } from './shared';

interface RecordingRow {
  id: number;
  lobbyCallId: number;
  lobbyName: string;
  startedAt: string;
  stoppedAt: string | null;
  duration: number | null;
  startedBy: string;
  status: string;
  canDownload: boolean;
  canPlay: boolean;
}

export function RecordingHistoryScreen() {
  const [items, setItems] = useState<RecordingRow[] | null>(null);
  const [playing, setPlaying] = useState<RecordingRow | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await apiRequest<{ items: RecordingRow[] }>('/api/monitoring/recordings');
      setItems(page.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load recordings.');
    }
  }, []);

  useMonitoringEvents(load);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Monitoring</p>
        <h1 className="text-2xl font-semibold">Recording history</h1>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-background">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Lobby</th>
              <th className="px-3 py-2 font-medium">Call</th>
              <th className="px-3 py-2 font-medium">Started</th>
              <th className="px-3 py-2 font-medium">Ended</th>
              <th className="px-3 py-2 font-medium">Duration</th>
              <th className="px-3 py-2 font-medium">Started by</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(items || []).map(row => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="px-3 py-2">{row.lobbyName}</td>
                <td className="px-3 py-2">{row.lobbyCallId}</td>
                <td className="px-3 py-2">{formatWhen(row.startedAt)}</td>
                <td className="px-3 py-2">{formatWhen(row.stoppedAt)}</td>
                <td className="px-3 py-2">{formatDuration(row.duration)}</td>
                <td className="px-3 py-2">{row.startedBy}</td>
                <td className="px-3 py-2">{row.status}</td>
                <td className="px-3 py-2">
                  {row.canDownload ? (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (row.canPlay) setPlaying(row);
                          else toast.message('This recording has no video file.');
                        }}
                      >
                        Play
                      </Button>
                      <Button variant="outline" asChild>
                        <a href={`/api/monitoring/recordings/${row.id}/file`}>Download</a>
                      </Button>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Unavailable</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items && items.length === 0 ? <p className="text-sm text-muted-foreground">No recordings yet.</p> : null}
      <Dialog open={Boolean(playing)} onOpenChange={open => { if (!open) setPlaying(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{playing ? `${playing.lobbyName} recording` : 'Recording'}</DialogTitle>
          </DialogHeader>
          {playing ? (
            <video
              key={playing.id}
              className="max-h-[70vh] w-full bg-black"
              controls
              autoPlay
              playsInline
              src={`/api/monitoring/recordings/${playing.id}/file?play=1`}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
