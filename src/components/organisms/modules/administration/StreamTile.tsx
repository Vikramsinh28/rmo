'use client';

import { streamPlayback, type StreamPlayback } from '@/lib/rmo/stream';
import Hls from 'hls.js';
import { Loader2, Maximize2, Monitor, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface StreamTileProps {
  name: string;
  lobbyName: string;
  deviceType: 'CAMERA' | 'KIOSK';
  streamUrl: string;
}

function videoMode(deviceType: 'CAMERA' | 'KIOSK', kind: StreamPlayback): 'hls' | 'file' | null {
  if (kind === 'file') return 'file';
  if (kind === 'hls') return 'hls';
  if (deviceType === 'CAMERA' && kind === 'page') return 'hls';
  return null;
}

function StreamLoader({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/80">
      <Loader2 className="size-6 animate-spin text-orange-400" aria-hidden />
      <p className="text-xs text-zinc-300">{label}</p>
    </div>
  );
}

function HlsVideo({ url, mode }: { url: string; mode: 'hls' | 'file' }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let hls: Hls | null = null;
    let attempts = 0;
    setError('');
    setLoading(true);

    const play = () => {
      video.play().catch(() => undefined);
    };

    const ready = () => {
      if (!cancelled) setLoading(false);
    };

    const fail = (message: string) => {
      if (!cancelled) {
        setError(message);
        setLoading(false);
      }
    };

    const start = () => {
      if (cancelled) return;
      setLoading(true);
      hls?.destroy();
      hls = null;
      video.removeAttribute('src');
      video.load();

      const nativeHls = video.canPlayType('application/vnd.apple.mpegurl');

      if (mode === 'file' || (nativeHls && !Hls.isSupported())) {
        video.src = url;
        video.addEventListener('loadeddata', ready, { once: true });
        video.addEventListener('playing', ready, { once: true });
        video.addEventListener('loadedmetadata', play, { once: true });
        video.addEventListener(
          'error',
          () => fail('Playback failed. Check that this address is a live HLS stream.'),
          { once: true },
        );
        return;
      }

      if (!Hls.isSupported()) {
        fail('This browser cannot play the HLS stream.');
        return;
      }

      hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, play);
      hls.on(Hls.Events.FRAG_LOADED, ready);
      video.addEventListener('playing', ready, { once: true });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || cancelled) return;
        attempts += 1;
        if (attempts >= 3) {
          fail('Playback failed. Check that this address is a live HLS stream.');
          hls?.destroy();
          hls = null;
          return;
        }
        window.setTimeout(start, 2000);
      });
    };

    start();
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [mode, url]);

  if (error) {
    return (
      <p className="px-4 text-center text-xs text-zinc-300">{error}</p>
    );
  }

  return (
    <>
      {loading ? <StreamLoader label="Loading stream..." /> : null}
      <video
        ref={videoRef}
        className="h-full w-full bg-black object-contain"
        muted
        playsInline
        autoPlay
      />
    </>
  );
}

function KioskPage({ name, url }: { name: string; url: string }) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const timer = window.setTimeout(() => setLoading(false), 12_000);
    return () => window.clearTimeout(timer);
  }, [url]);

  return (
    <>
      {loading ? <StreamLoader label="Loading kiosk..." /> : null}
      <iframe
        title={name}
        src={url}
        className="absolute inset-0 h-full w-full border-0 bg-black"
        allow="fullscreen; autoplay"
        onLoad={() => setLoading(false)}
      />
    </>
  );
}

export function StreamFrame({
  name,
  deviceType,
  streamUrl,
}: {
  name: string;
  deviceType: 'CAMERA' | 'KIOSK';
  streamUrl: string;
}) {
  const kind = streamPlayback(streamUrl);
  const mode = videoMode(deviceType, kind);

  return (
    <div className="relative flex h-full min-h-0 w-full items-center justify-center bg-black">
      {mode ? <HlsVideo url={streamUrl} mode={mode} /> : null}
      {kind === 'page' && deviceType === 'KIOSK' ? (
        <KioskPage name={name} url={streamUrl} />
      ) : null}
      {kind === 'unsupported' ? (
        <p className="px-4 text-center text-xs text-zinc-300">
          This address cannot play in the browser. Use an HLS stream or a web page.
        </p>
      ) : null}
    </div>
  );
}

export function StreamTile({ name, lobbyName, deviceType, streamUrl }: StreamTileProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const Icon = deviceType === 'CAMERA' ? Video : Monitor;

  const openFullscreen = () => {
    const frame = frameRef.current;
    if (!frame) return;
    if (document.fullscreenElement === frame) {
      document.exitFullscreen().catch(() => undefined);
      return;
    }
    frame.requestFullscreen().catch(() => undefined);
  };

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <Icon className="size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{lobbyName}</p>
        </div>
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={openFullscreen}
          aria-label={`Fullscreen ${name}`}
        >
          <Maximize2 className="size-4" />
        </button>
      </header>
      <div ref={frameRef} className="relative aspect-video bg-black">
        <StreamFrame name={name} deviceType={deviceType} streamUrl={streamUrl} />
      </div>
    </article>
  );
}
