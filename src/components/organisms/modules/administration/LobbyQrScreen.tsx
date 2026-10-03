'use client';

import { Button } from '@/components/ui/button';
import { apiRequest } from '@/components/organisms/modules/administration/api';
import { useAuthStore } from '@/store/auth';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

interface LobbyQr {
  lobbyId: number;
  lobbyName: string;
  divisionName: string;
  publicPath: string;
  publicUrl: string;
  instruction: string;
}

export function LobbyQrScreen() {
  const role = useAuthStore(state => state.user?.rmoRole);
  const canRegenerate = role === 'SYSTEM_ADMIN' || role === 'DIVISION_ADMIN';
  const [items, setItems] = useState<LobbyQr[]>([]);
  const [selectedId, setSelectedId] = useState<number | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiRequest<{ items: LobbyQr[] }>('/api/lobbies/qr');
      setItems(data.items);
      setSelectedId(current =>
        current && data.items.some(item => item.lobbyId === current)
          ? current
          : data.items[0]?.lobbyId || '',
      );
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load lobby QR codes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selected = useMemo(
    () => items.find(item => item.lobbyId === selectedId) || null,
    [items, selectedId],
  );

  const copyLink = async () => {
    if (!selected) return;
    await navigator.clipboard.writeText(selected.publicUrl);
    toast.success('Public link copied');
  };

  const download = () => {
    if (!selected) return;
    const anchor = document.createElement('a');
    anchor.href = `/api/lobbies/${selected.lobbyId}/qr/image`;
    anchor.download = `${selected.lobbyName}-crew-form-qr.png`;
    anchor.click();
  };

  const printQr = () => {
    if (!selected) return;
    const win = window.open('', '_blank', 'noopener,noreferrer,width=720,height=900');
    if (!win) return;
    win.document.write(`<!doctype html><html><head><title>Lobby QR</title>
      <style>
        body{font-family:system-ui,sans-serif;margin:40px;text-align:center;color:#111}
        h1{font-size:22px;margin:0 0 8px} p{margin:4px 0;color:#444}
        img{width:320px;height:320px;margin:24px 0}
      </style></head><body>
      <h1>RMO Remote Monitoring</h1>
      <p>Division: ${selected.divisionName}</p>
      <p>Lobby: ${selected.lobbyName}</p>
      <p><strong>Crew Public Form</strong></p>
      <img src="/api/lobbies/${selected.lobbyId}/qr/image" alt="Lobby QR" />
      <p>${selected.instruction}</p>
      <script>window.onload=()=>setTimeout(()=>window.print(),250)</script>
      </body></html>`);
    win.document.close();
  };

  const regenerate = async () => {
    if (!selected || !canRegenerate) return;
    try {
      const next = await apiRequest<LobbyQr>(`/api/lobbies/${selected.lobbyId}/qr`, {
        method: 'POST',
        body: JSON.stringify({ action: 'regenerate' }),
      });
      setItems(current =>
        current.map(item => (item.lobbyId === next.lobbyId ? next : item)),
      );
      toast.success('QR token regenerated');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not regenerate QR');
    }
  };

  if (loading) {
    return <p className="px-4 text-sm text-muted-foreground lg:px-6">Loading lobby QR…</p>;
  }
  if (error) {
    return <p className="px-4 text-sm text-destructive lg:px-6">{error}</p>;
  }
  if (!selected) {
    return <p className="px-4 text-sm text-muted-foreground lg:px-6">No lobbies available.</p>;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 lg:px-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Lobby QR</h1>
        <p className="text-sm text-muted-foreground">
          Public crew form entry point for authorized lobbies.
        </p>
      </div>

      {items.length > 1 ? (
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Lobby</span>
          <select
            className="h-9 w-full max-w-md rounded-md border bg-background px-3"
            value={selectedId}
            onChange={event => setSelectedId(Number(event.target.value))}
          >
            {items.map(item => (
              <option key={item.lobbyId} value={item.lobbyId}>
                {item.divisionName} — {item.lobbyName}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <section className="rounded-xl border bg-card p-6 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          RMO Remote Monitoring
        </p>
        <p className="mt-2 text-sm">Division: {selected.divisionName}</p>
        <p className="text-sm">Lobby: {selected.lobbyName}</p>
        <p className="mt-2 font-semibold">Crew Public Form</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={selected.publicUrl}
          src={`/api/lobbies/${selected.lobbyId}/qr/image`}
          alt={`QR for ${selected.lobbyName}`}
          className="mx-auto mt-4 h-64 w-64 rounded-md border bg-white p-2"
        />
        <p className="mt-3 text-sm text-muted-foreground">{selected.instruction}</p>
        <p className="mt-2 break-all text-xs text-muted-foreground">{selected.publicUrl}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button className="h-9" variant="outline" onClick={download}>
            Download QR
          </Button>
          <Button className="h-9" variant="outline" onClick={printQr}>
            Print QR
          </Button>
          <Button className="h-9" variant="outline" onClick={copyLink}>
            Copy Link
          </Button>
          {canRegenerate ? (
            <Button className="h-9" variant="secondary" onClick={regenerate}>
              Regenerate Token
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
