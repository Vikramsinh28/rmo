'use client';

import { StreamFrame } from '@/components/organisms/modules/administration/StreamTile';
import { Monitor, Video } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { apiRequest } from '../administration/api';

interface Feed {
  id: number;
  name: string;
  deviceType: 'CAMERA' | 'KIOSK';
  streamUrl: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function shareKey(lobbyId: number) {
  return `rmo-desk-share:${lobbyId}`;
}

function readShare(lobbyId: number) {
  try {
    const value = Number(sessionStorage.getItem(shareKey(lobbyId)));
    if (Number.isFinite(value) && value >= 0.38 && value <= 0.72) return value;
  } catch {
    // A missing share just uses the default split.
  }
  return 0.6;
}

function orderedFeeds(items: Feed[]) {
  return [...items].sort((left, right) => {
    if (left.deviceType !== right.deviceType) return left.deviceType === 'KIOSK' ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

export function DeskWorkspace({
  lobbyId,
  lobbyName,
  children,
}: {
  lobbyId: number;
  lobbyName: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef(0.6);
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [callShare, setCallShare] = useState(0.6);
  const [heroId, setHeroId] = useState<number | null>(null);
  shareRef.current = callShare;

  useEffect(() => {
    let cancelled = false;
    setFeeds(null);
    setHeroId(null);
    setCallShare(readShare(lobbyId));
    apiRequest<{ items: Feed[] }>(`/api/admin/devices?status=ACTIVE&lobbyId=${lobbyId}&pageSize=50`)
      .then(page => {
        if (!cancelled) setFeeds(orderedFeeds(page.items));
      })
      .catch(() => {
        if (!cancelled) setFeeds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [lobbyId]);

  function startSplit(event: ReactPointerEvent<HTMLElement>) {
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width < 1) return;
    event.preventDefault();
    const move = (pointer: PointerEvent) => {
      const share = clamp((pointer.clientX - bounds.left) / bounds.width, 0.38, 0.72);
      shareRef.current = share;
      setCallShare(share);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      try {
        sessionStorage.setItem(shareKey(lobbyId), String(shareRef.current));
      } catch {
        // The split still applies for this visit.
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  }

  const list = feeds || [];
  const hero = list.find(item => item.id === heroId) || list[0] || null;
  const rest = hero ? list.filter(item => item.id !== hero.id) : [];
  const kiosks = list.filter(item => item.deviceType === 'KIOSK').length;
  const cameras = list.filter(item => item.deviceType === 'CAMERA').length;
  const hasFeeds = list.length > 0;

  return (
    <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1">
      <div
        className="flex h-full min-w-0 flex-col"
        style={{ width: hasFeeds ? `${callShare * 100}%` : '100%' }}
      >
        {children}
      </div>
      {hasFeeds || feeds === null ? (
        <>
          <button
            type="button"
            aria-label="Resize the call and the lobby pictures"
            onPointerDown={startSplit}
            className="group relative w-3 shrink-0 cursor-col-resize touch-none"
          >
            <span className="absolute inset-y-3 left-1/2 w-1 -translate-x-1/2 rounded-full bg-white/15 group-hover:bg-orange-400" />
          </button>
          <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-zinc-900/50">
            <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-orange-200/80">
                  Lobby picture
                </p>
                <h2 className="truncate text-sm font-semibold text-zinc-50">{lobbyName}</h2>
              </div>
              <p className="shrink-0 text-[11px] text-zinc-400">
                {feeds === null ? 'Loading' : `${kiosks} kiosk · ${cameras} camera${cameras === 1 ? '' : 's'}`}
              </p>
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {feeds === null ? <WallSkeleton /> : null}
              {feeds && feeds.length === 0 ? (
                <p className="rounded-2xl border border-white/10 px-4 py-8 text-center text-sm text-zinc-400">
                  No kiosk or camera is assigned to this lobby.
                </p>
              ) : null}
              {hero ? (
                <FeedTile
                  feed={hero}
                  featured
                  onOpen={() => setHeroId(hero.id)}
                />
              ) : null}
              {rest.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {rest.map(feed => (
                    <FeedTile
                      key={feed.id}
                      feed={feed}
                      onOpen={() => setHeroId(feed.id)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function WallSkeleton() {
  return (
    <div className="space-y-3">
      <div className="aspect-video animate-pulse rounded-2xl bg-white/5" />
      <div className="grid grid-cols-2 gap-3">
        <div className="aspect-video animate-pulse rounded-2xl bg-white/5" />
        <div className="aspect-video animate-pulse rounded-2xl bg-white/5" />
      </div>
    </div>
  );
}

function FeedTile({
  feed,
  featured = false,
  onOpen,
}: {
  feed: Feed;
  featured?: boolean;
  onOpen: () => void;
}) {
  const kiosk = feed.deviceType === 'KIOSK';
  const Icon = kiosk ? Monitor : Video;

  return (
    <article
      className={`group relative overflow-hidden rounded-2xl bg-black ring-1 ring-white/10 ${featured ? 'shadow-2xl ring-white/20' : 'cursor-pointer hover:ring-orange-300/70'}`}
    >
      <div className="relative aspect-video">
        <div className="absolute inset-0">
          <StreamFrame name={feed.name} deviceType={feed.deviceType} streamUrl={feed.streamUrl} />
        </div>
        {featured ? null : (
          <button
            type="button"
            aria-label={`Show ${feed.name} large`}
            onClick={onOpen}
            className="absolute inset-0 z-10"
          />
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-3 py-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
            Live
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${kiosk ? 'bg-orange-500 text-white' : 'bg-white/15 text-zinc-100'}`}>
            <Icon className="size-3" />
            {kiosk ? 'Kiosk' : 'Camera'}
          </span>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
          <p className="truncate text-sm font-medium text-white">{feed.name}</p>
        </div>
      </div>
    </article>
  );
}
