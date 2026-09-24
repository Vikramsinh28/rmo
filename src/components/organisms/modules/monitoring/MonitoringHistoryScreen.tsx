'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../administration/api';
import { formatDuration, formatWhen, useMonitoringEvents } from './shared';

interface HistoryRow {
  id: number;
  lobbyName: string;
  divisionName: string;
  monitorName: string;
  startedAt: string;
  endedAt: string | null;
  duration: number;
  participantCount: number;
  recordingCount: number;
  status: string;
}

export function MonitoringHistoryScreen() {
  const [items, setItems] = useState<HistoryRow[] | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await apiRequest<{ items: HistoryRow[] }>('/api/monitoring/history');
      setItems(page.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load call history.');
    }
  }, []);

  useMonitoringEvents(load);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Monitoring</p>
        <h1 className="text-2xl font-semibold">Call history</h1>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-background">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Lobby</th>
              <th className="px-3 py-2 font-medium">Monitor</th>
              <th className="px-3 py-2 font-medium">Start</th>
              <th className="px-3 py-2 font-medium">End</th>
              <th className="px-3 py-2 font-medium">Duration</th>
              <th className="px-3 py-2 font-medium">Participants</th>
              <th className="px-3 py-2 font-medium">Recordings</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(items || []).map(row => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="px-3 py-2">{row.lobbyName}<div className="text-xs text-muted-foreground">{row.divisionName}</div></td>
                <td className="px-3 py-2">{row.monitorName}</td>
                <td className="px-3 py-2">{formatWhen(row.startedAt)}</td>
                <td className="px-3 py-2">{formatWhen(row.endedAt)}</td>
                <td className="px-3 py-2">{formatDuration(row.duration)}</td>
                <td className="px-3 py-2">{row.participantCount}</td>
                <td className="px-3 py-2">{row.recordingCount}</td>
                <td className="px-3 py-2">{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items && items.length === 0 ? <p className="text-sm text-muted-foreground">No calls yet.</p> : null}
    </div>
  );
}
