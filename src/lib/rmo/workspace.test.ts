import { defaultWorkspace, parseWorkspace, placeOnTab, type DropPayload } from './workspace';

const camera: DropPayload = {
  panelId: 'camera:4',
  type: 'camera',
  sourceId: '4',
  title: 'Main Entrance',
};

describe('live workspace layout', () => {
  it('starts with three empty tabs', () => {
    const layout = defaultWorkspace();
    expect(layout.tabs.map(tab => tab.title)).toEqual(['Ops 1', 'Ops 2', 'Ops 3']);
    expect(layout.tabs[0].layoutMode).toBe('grid');
    expect(layout.tabs[1].layoutMode).toBe('free');
  });

  it('places a dropped camera on the target tab', () => {
    const next = placeOnTab(defaultWorkspace(), camera, 'ops-2', { x: 200, y: 120 });
    expect(next.activeTabIndex).toBe(1);
    expect(next.tabs[1].panels).toHaveLength(1);
    expect(next.tabs[1].panels[0].x).toBe(200 - 180);
    expect(next.tabs[0].panels).toHaveLength(0);
  });

  it('moves an existing panel instead of duplicating it', () => {
    const placed = placeOnTab(defaultWorkspace(), camera, 'ops-1');
    const moved = placeOnTab(placed, camera, 'ops-3');
    const count = moved.tabs.reduce((sum, tab) => sum + tab.panels.length, 0);
    expect(count).toBe(1);
    expect(moved.tabs[2].panels[0].id).toBe('camera:4');
  });

  it('restores a saved layout and drops a broken one', () => {
    const saved = JSON.stringify(placeOnTab(defaultWorkspace(), camera, 'ops-1'));
    expect(parseWorkspace(saved)?.tabs[0].panels[0].title).toBe('Main Entrance');
    expect(parseWorkspace('not-json')).toBeNull();
  });
});
