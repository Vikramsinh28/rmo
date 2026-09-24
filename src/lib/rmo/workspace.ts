export type LayoutMode = 'grid' | 'free';
export type PanelType = 'camera' | 'kiosk';

export interface WorkspacePanel {
  id: string;
  type: PanelType;
  title: string;
  sourceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkspaceTab {
  id: string;
  title: string;
  layoutMode: LayoutMode;
  panels: WorkspacePanel[];
}

export interface WorkspaceLayout {
  activeTabIndex: number;
  sidebarCollapsed: boolean;
  sourcesChosen: boolean;
  tabs: WorkspaceTab[];
}

export interface DropPayload {
  panelId: string;
  type: PanelType;
  sourceId: string;
  title: string;
}

export const WORKSPACE_STORAGE_PREFIX = 'rmo-live-workspace-v1';

const TILE_WIDTH = 360;
const TILE_HEIGHT = 228;

export function defaultWorkspace(): WorkspaceLayout {
  return {
    activeTabIndex: 0,
    sidebarCollapsed: true,
    sourcesChosen: false,
    tabs: [
      { id: 'ops-1', title: 'Ops 1', layoutMode: 'grid', panels: [] },
      { id: 'ops-2', title: 'Ops 2', layoutMode: 'free', panels: [] },
      { id: 'ops-3', title: 'Ops 3', layoutMode: 'free', panels: [] },
    ],
  };
}

export function defaultPanelRect(index: number) {
  const gap = 20;
  const column = index % 2;
  const row = Math.floor(index / 2);
  return {
    x: 20 + column * (TILE_WIDTH + gap),
    y: 20 + row * (TILE_HEIGHT + gap),
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
  };
}

export function panelIdFor(type: PanelType, sourceId: string) {
  return `${type}:${sourceId}`;
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizePanel(value: unknown): WorkspacePanel | null {
  if (!value || typeof value !== 'object') return null;
  const panel = value as Partial<WorkspacePanel>;
  if (panel.type !== 'camera' && panel.type !== 'kiosk') return null;
  if (!panel.sourceId) return null;
  const rect = defaultPanelRect(0);
  return {
    id: panel.id || panelIdFor(panel.type, String(panel.sourceId)),
    type: panel.type,
    title: panel.title || 'Panel',
    sourceId: String(panel.sourceId),
    x: asNumber(panel.x, rect.x),
    y: asNumber(panel.y, rect.y),
    width: asNumber(panel.width, rect.width),
    height: asNumber(panel.height, rect.height),
  };
}

export function parseWorkspace(raw: string | null): WorkspaceLayout | null {
  if (!raw) return null;
  try {
    const decoded = JSON.parse(raw) as Partial<WorkspaceLayout>;
    if (!Array.isArray(decoded.tabs) || decoded.tabs.length === 0) return null;
    const tabs: WorkspaceTab[] = [];
    for (const value of decoded.tabs) {
      if (!value || typeof value !== 'object') continue;
      const tab = value as Partial<WorkspaceTab>;
      if (!tab.id || !tab.title) continue;
      const panels = Array.isArray(tab.panels)
        ? tab.panels.flatMap(panel => {
            const normalized = normalizePanel(panel);
            return normalized ? [normalized] : [];
          })
        : [];
      tabs.push({
        id: String(tab.id),
        title: String(tab.title),
        layoutMode: tab.layoutMode === 'free' ? 'free' : 'grid',
        panels,
      });
    }
    if (tabs.length === 0) return null;
    const requested = typeof decoded.activeTabIndex === 'number' ? decoded.activeTabIndex : 0;
    const sourcesChosen = decoded.sourcesChosen === true;
    return {
      activeTabIndex: Math.min(Math.max(requested, 0), tabs.length - 1),
      sidebarCollapsed: sourcesChosen ? decoded.sidebarCollapsed === true : true,
      sourcesChosen,
      tabs,
    };
  } catch {
    return null;
  }
}

export function placeOnTab(
  layout: WorkspaceLayout,
  drop: DropPayload,
  targetTabId: string,
  offset?: { x: number; y: number } | null,
): WorkspaceLayout {
  const targetIndex = layout.tabs.findIndex(tab => tab.id === targetTabId);
  if (targetIndex < 0) return layout;
  let existing: WorkspacePanel | undefined;
  const tabs = layout.tabs.map(tab => ({
    ...tab,
    panels: tab.panels.filter(panel => {
      if (panel.id !== drop.panelId) return true;
      existing = panel;
      return false;
    }),
  }));
  const target = tabs[targetIndex];
  const rect = defaultPanelRect(target.panels.length);
  const panel: WorkspacePanel = existing
    ? { ...existing, title: drop.title || existing.title }
    : {
        id: drop.panelId,
        type: drop.type,
        title: drop.title,
        sourceId: drop.sourceId,
        ...rect,
      };
  if (target.layoutMode === 'free' && offset) {
    panel.x = offset.x - panel.width / 2;
    panel.y = offset.y - 28;
  }
  tabs[targetIndex] = { ...target, panels: [...target.panels, panel] };
  return { ...layout, tabs, activeTabIndex: targetIndex };
}

export function removePanel(layout: WorkspaceLayout, panelId: string): WorkspaceLayout {
  return {
    ...layout,
    tabs: layout.tabs.map(tab => ({
      ...tab,
      panels: tab.panels.filter(panel => panel.id !== panelId),
    })),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function movePanel(
  panel: WorkspacePanel,
  deltaX: number,
  deltaY: number,
  canvas: { width: number; height: number },
): WorkspacePanel {
  const maxX = Math.max(0, canvas.width - panel.width);
  const maxY = Math.max(0, canvas.height - panel.height);
  return {
    ...panel,
    x: clamp(panel.x + deltaX, 0, maxX),
    y: clamp(panel.y + deltaY, 0, maxY),
  };
}

export function resizePanel(
  panel: WorkspacePanel,
  deltaX: number,
  deltaY: number,
  canvas: { width: number; height: number },
): WorkspacePanel {
  const maxWidth = Math.min(920, Math.max(280, canvas.width - panel.x));
  const maxHeight = Math.min(640, Math.max(190, canvas.height - panel.y));
  return {
    ...panel,
    width: clamp(panel.width + deltaX, 280, maxWidth),
    height: clamp(panel.height + deltaY, 190, maxHeight),
  };
}

export function toggleLayout(layout: WorkspaceLayout): WorkspaceLayout {
  const tabs = layout.tabs.map((tab, index) => {
    if (index !== layout.activeTabIndex) return tab;
    return { ...tab, layoutMode: tab.layoutMode === 'grid' ? 'free' as const : 'grid' as const };
  });
  return { ...layout, tabs };
}
