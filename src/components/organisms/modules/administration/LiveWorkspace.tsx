'use client';

import { Button } from '@/components/ui/button';
import {
  defaultWorkspace,
  movePanel,
  panelIdFor,
  parseWorkspace,
  placeOnTab,
  removePanel,
  resizePanel,
  toggleLayout,
  WORKSPACE_STORAGE_PREFIX,
  type DropPayload,
  type LayoutMode,
  type PanelType,
  type WorkspaceLayout,
  type WorkspacePanel,
} from '@/lib/rmo/workspace';
import { useAuthStore } from '@/store/auth';
import {
  GripVertical,
  LayoutGrid,
  Monitor,
  Move,
  PanelLeft,
  RefreshCw,
  RotateCcw,
  Square,
  Video,
  X,
} from 'lucide-react';
import {
  DragEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { apiRequest } from './api';
import { StreamFrame } from './StreamTile';

interface Device {
  id: number;
  name: string;
  deviceType: 'CAMERA' | 'KIOSK';
  streamUrl: string;
  isActive: boolean;
  lobby: { name: string };
}

interface Page {
  items: Device[];
  total: number;
}

const DROP_TYPE = 'application/x-rmo-panel';

async function loadActiveDevices() {
  const items: Device[] = [];
  let page = 1;
  let total = 0;
  do {
    const result = await apiRequest<Page>(
      `/api/admin/devices?status=ACTIVE&page=${page}&pageSize=50`,
    );
    items.push(...result.items);
    total = result.total;
    page += 1;
  } while (items.length < total && page <= 8);
  return items;
}

function readDrop(event: DragEvent): DropPayload | null {
  const raw = event.dataTransfer.getData(DROP_TYPE) || event.dataTransfer.getData('text/plain');
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as DropPayload;
    if (value.type !== 'camera' && value.type !== 'kiosk') return null;
    if (!value.panelId || !value.sourceId) return null;
    return value;
  } catch {
    return null;
  }
}

function writeDrop(event: DragEvent, payload: DropPayload) {
  const raw = JSON.stringify(payload);
  event.dataTransfer.setData(DROP_TYPE, raw);
  event.dataTransfer.setData('text/plain', raw);
  event.dataTransfer.effectAllowed = 'copy';
}

export function LiveWorkspace() {
  const userId = useAuthStore(state => state.user?.id);
  const storageKey = `${WORKSPACE_STORAGE_PREFIX}:${userId || 'local'}`;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<WorkspaceLayout>(defaultWorkspace);
  const [hydrated, setHydrated] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);

  useEffect(() => {
    const saved = parseWorkspace(window.localStorage.getItem(storageKey));
    if (saved) setLayout(saved);
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    const handle = window.setTimeout(() => {
      window.localStorage.setItem(storageKey, JSON.stringify(layout));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [hydrated, layout, storageKey]);

  const load = () => {
    setLoading(true);
    setError('');
    loadActiveDevices()
      .then(setDevices)
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const active = layout.tabs[layout.activeTabIndex] ?? layout.tabs[0];
  const cameras = devices.filter(device => device.deviceType === 'CAMERA');
  const kiosks = devices.filter(device => device.deviceType === 'KIOSK');
  const byId = new Map(devices.map(device => [String(device.id), device]));

  const dropOnTab = (event: DragEvent, tabId: string, useOffset: boolean) => {
    event.preventDefault();
    setDragOver(false);
    const payload = readDrop(event);
    if (!payload) return;
    let offset: { x: number; y: number } | null = null;
    if (useOffset && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      offset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }
    setLayout(current => placeOnTab(current, payload, tabId, offset));
  };

  const nudge = (
    panel: WorkspacePanel,
    event: ReactPointerEvent,
    kind: 'move' | 'resize',
  ) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = { width: canvas.clientWidth, height: canvas.clientHeight };
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = panel;
    const move = (pointer: PointerEvent) => {
      const deltaX = pointer.clientX - startX;
      const deltaY = pointer.clientY - startY;
      setLayout(current => ({
        ...current,
        tabs: current.tabs.map(tab => ({
          ...tab,
          panels: tab.panels.map(item => {
            if (item.id !== origin.id) return item;
            return kind === 'move'
              ? movePanel(origin, deltaX, deltaY, bounds)
              : resizePanel(origin, deltaX, deltaY, bounds);
          }),
        })),
      }));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const fullscreen = fullscreenId
    ? layout.tabs.flatMap(tab => tab.panels).find(panel => panel.id === fullscreenId)
    : undefined;

  return (
    <div className="flex min-h-0 flex-1 bg-background">
      <SourceSidebar
        collapsed={layout.sidebarCollapsed}
        cameras={cameras}
        kiosks={kiosks}
        loading={loading}
        layoutMode={active?.layoutMode || 'grid'}
        onToggle={() =>
          setLayout(current => ({
            ...current,
            sidebarCollapsed: !current.sidebarCollapsed,
            sourcesChosen: true,
          }))
        }
        onLayout={() => setLayout(toggleLayout)}
        onRefresh={load}
        onReset={() => {
          setFullscreenId(null);
          setLayout(defaultWorkspace());
        }}
        onAdd={payload => {
          if (!active) return;
          setLayout(current => placeOnTab(current, payload, active.id));
        }}
      />
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
            {layout.tabs.map((tab, index) => {
              const selected = index === layout.activeTabIndex;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setLayout(current => ({ ...current, activeTabIndex: index }))}
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => dropOnTab(event, tab.id, false)}
                  className={
                    selected
                      ? 'flex shrink-0 items-center gap-2 rounded-xl bg-primary/15 px-3.5 py-2.5 text-sm font-semibold'
                      : 'flex shrink-0 items-center gap-2 rounded-xl bg-muted px-3.5 py-2.5 text-sm font-semibold text-muted-foreground'
                  }
                >
                  {tab.layoutMode === 'grid' ? <LayoutGrid className="size-4" /> : <Square className="size-4" />}
                  {tab.title}
                  <span className="rounded-full bg-black/10 px-1.5 text-[11px]">{tab.panels.length}</span>
                </button>
              );
            })}
          </div>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {active?.layoutMode === 'grid' ? 'Grid' : 'Free'}
          </span>
        </div>
        {error ? <p className="px-4 text-sm text-destructive">{error}</p> : null}
        <div className="min-h-0 flex-1 px-4 pb-4">
          <div
            ref={canvasRef}
            onDragOver={event => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={event => active && dropOnTab(event, active.id, true)}
            className={
              dragOver
                ? 'h-full min-h-[28rem] overflow-auto rounded-2xl border border-primary/40 bg-primary/5'
                : 'h-full min-h-[28rem] overflow-auto rounded-2xl border bg-card'
            }
          >
            {!active || active.panels.length === 0 ? (
              <div className="flex h-full min-h-[28rem] flex-col items-center justify-center px-6 text-center">
                <Square className="size-12 text-muted-foreground/40" />
                <p className="mt-3 text-base font-semibold">Drag a kiosk or camera into this tab</p>
                <p className="mt-2 max-w-md text-xs text-muted-foreground">
                  Each tab keeps its own layout. Grid lines the panels up. Free lets you move and
                  resize them. This browser saves the arrangement.
                </p>
              </div>
            ) : active.layoutMode === 'grid' ? (
              <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                {active.panels.map(panel => (
                  <PanelCard
                    key={panel.id}
                    panel={panel}
                    device={byId.get(panel.sourceId)}
                    free={false}
                    onClose={() => {
                      setFullscreenId(current => (current === panel.id ? null : current));
                      setLayout(current => removePanel(current, panel.id));
                    }}
                    onFullscreen={() => setFullscreenId(panel.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="relative h-full min-h-[36rem]">
                {active.panels.map(panel => (
                  <div
                    key={panel.id}
                    className="absolute"
                    style={{
                      left: panel.x,
                      top: panel.y,
                      width: panel.width,
                      height: panel.height,
                    }}
                  >
                    <PanelCard
                      panel={panel}
                      device={byId.get(panel.sourceId)}
                      free
                      onMove={event => nudge(panel, event, 'move')}
                      onResize={event => nudge(panel, event, 'resize')}
                      onClose={() => {
                        setFullscreenId(current => (current === panel.id ? null : current));
                        setLayout(current => removePanel(current, panel.id));
                      }}
                      onFullscreen={() => setFullscreenId(panel.id)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
      {fullscreen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/80 p-4">
          <PanelCard
            panel={fullscreen}
            device={byId.get(fullscreen.sourceId)}
            free={false}
            onClose={() => setFullscreenId(null)}
            onFullscreen={() => setFullscreenId(null)}
            fullscreen
          />
        </div>
      ) : null}
    </div>
  );
}

function SourceSidebar({
  collapsed,
  cameras,
  kiosks,
  loading,
  layoutMode,
  onToggle,
  onLayout,
  onRefresh,
  onReset,
  onAdd,
}: {
  collapsed: boolean;
  cameras: Device[];
  kiosks: Device[];
  loading: boolean;
  layoutMode: LayoutMode;
  onToggle: () => void;
  onLayout: () => void;
  onRefresh: () => void;
  onReset: () => void;
  onAdd: (payload: DropPayload) => void;
}) {
  if (collapsed) {
    return (
      <aside className="flex w-14 shrink-0 flex-col items-center gap-1 border-r py-3">
        <IconButton label="Expand sources" onClick={onToggle}><PanelLeft className="size-4" /></IconButton>
        <IconButton label={layoutMode === 'grid' ? 'Switch to free layout' : 'Switch to grid layout'} onClick={onLayout}>
          <LayoutGrid className="size-4" />
        </IconButton>
        <IconButton label="Refresh devices" onClick={onRefresh}><RefreshCw className="size-4" /></IconButton>
        <IconButton label="Reset workspace" onClick={onReset}><RotateCcw className="size-4" /></IconButton>
        <p className="mt-auto rotate-180 text-[10px] font-bold tracking-widest text-muted-foreground [writing-mode:vertical-rl]">
          WORKSPACE
        </p>
      </aside>
    );
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r">
      <div className="flex items-center gap-2 px-4 pt-4">
        <h2 className="flex-1 text-lg font-bold">Workspace sources</h2>
        <IconButton label="Collapse sources" onClick={onToggle}><PanelLeft className="size-4" /></IconButton>
      </div>
      <div className="flex gap-1 px-4 pt-2">
        <Button type="button" variant="outline" onClick={onLayout}>
          {layoutMode === 'grid' ? 'Free layout' : 'Grid layout'}
        </Button>
        <Button type="button" variant="outline" onClick={onRefresh}>Refresh</Button>
        <Button type="button" variant="outline" onClick={onReset}>Reset</Button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section>
          <SectionTitle>Live lobbies</SectionTitle>
          <p className="rounded-xl border px-3 py-3 text-xs text-muted-foreground">No lobbies online</p>
        </section>
        <section>
          <SectionTitle>Fixed kiosk screens</SectionTitle>
          {kiosks.length === 0 ? (
            <p className="rounded-xl border px-3 py-3 text-xs text-muted-foreground">
              {loading ? 'Loading kiosks…' : 'No kiosk devices'}
            </p>
          ) : (
            kiosks.map(device => (
              <SourceTile
                key={device.id}
                title={device.name}
                subtitle={`${device.lobby.name} · configured stream`}
                kind="kiosk"
                payload={payloadFor(device)}
                onAdd={() => onAdd(payloadFor(device))}
              />
            ))
          )}
        </section>
        <section>
          <SectionTitle>CCTV cameras</SectionTitle>
          {cameras.length === 0 ? (
            <p className="rounded-xl border px-3 py-3 text-xs text-muted-foreground">
              {loading ? 'Loading cameras…' : 'No CCTV cameras available'}
            </p>
          ) : (
            cameras.map(device => (
              <SourceTile
                key={device.id}
                title={device.name}
                subtitle={device.lobby.name}
                kind="camera"
                payload={payloadFor(device)}
                onAdd={() => onAdd(payloadFor(device))}
              />
            ))
          )}
        </section>
      </div>
    </aside>
  );
}

function payloadFor(device: Device): DropPayload {
  const type: PanelType = device.deviceType === 'CAMERA' ? 'camera' : 'kiosk';
  return {
    panelId: panelIdFor(type, String(device.id)),
    type,
    sourceId: String(device.id),
    title: device.name,
  };
}

function SourceTile({
  title,
  subtitle,
  kind,
  payload,
  onAdd,
}: {
  title: string;
  subtitle: string;
  kind: PanelType;
  payload: DropPayload;
  onAdd: () => void;
}) {
  const Icon = kind === 'camera' ? Video : Monitor;
  const tone = kind === 'camera' ? 'bg-orange-500/15 text-orange-600' : 'bg-blue-500/15 text-blue-600';
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onClick={onAdd}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') onAdd();
      }}
      onDragStart={event => writeDrop(event, payload)}
      className="mb-2 cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-center gap-3 rounded-2xl border bg-card px-3 py-3">
        <span className={`rounded-lg p-2 ${tone}`}><Icon className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{title}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span>
        </span>
        <GripVertical className="size-4 text-muted-foreground" />
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

function PanelCard({
  panel,
  device,
  free,
  fullscreen,
  onClose,
  onFullscreen,
  onMove,
  onResize,
}: {
  panel: WorkspacePanel;
  device?: Device;
  free: boolean;
  fullscreen?: boolean;
  onClose: () => void;
  onFullscreen: () => void;
  onMove?: (event: ReactPointerEvent) => void;
  onResize?: (event: ReactPointerEvent) => void;
}) {
  const payload: DropPayload = {
    panelId: panel.id,
    type: panel.type,
    sourceId: panel.sourceId,
    title: panel.title,
  };
  const Icon = panel.type === 'camera' ? Video : Monitor;
  return (
    <article className="relative flex h-full min-h-52 flex-col overflow-hidden rounded-2xl border bg-card shadow-lg">
      <header className="flex h-11 items-center gap-2 border-b bg-muted/50 px-2">
        {free && onMove ? (
          <button
            type="button"
            aria-label={`Move ${panel.title}`}
            className="cursor-move p-1 text-muted-foreground"
            onPointerDown={onMove}
          >
            <Move className="size-4" />
          </button>
        ) : null}
        <span
          draggable={!fullscreen}
          onDragStart={event => writeDrop(event, payload)}
          className="cursor-grab text-muted-foreground active:cursor-grabbing"
          aria-label={`Drag ${panel.title} to another tab`}
        >
          <GripVertical className="size-4" />
        </span>
        <Icon className={panel.type === 'camera' ? 'size-4 text-orange-500' : 'size-4 text-blue-500'} />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{panel.title}</p>
        <button type="button" aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={onFullscreen} className="p-1">
          <Square className="size-4" />
        </button>
        <button type="button" aria-label={`Close ${panel.title}`} onClick={onClose} className="p-1">
          <X className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        {device ? (
          <StreamFrame
            name={device.name}
            deviceType={device.deviceType}
            streamUrl={device.streamUrl}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {panel.type === 'camera' ? 'Camera unavailable' : 'Kiosk unavailable'}
          </div>
        )}
      </div>
      {free && onResize ? (
        <button
          type="button"
          aria-label={`Resize ${panel.title}`}
          className="absolute bottom-1 right-1 cursor-nwse-resize p-1 text-muted-foreground"
          onPointerDown={onResize}
        >
          <GripVertical className="size-4 rotate-45" />
        </button>
      ) : null}
    </article>
  );
}
