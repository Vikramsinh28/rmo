'use client';

import type { TrendPoint } from '@/lib/rmo/series';

export function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">No dates in this range.</p>;
  }
  const width = 640;
  const height = 220;
  const max = Math.max(1, ...points.map(point => point.count));
  const step = points.length === 1 ? 0 : (width - 24) / (points.length - 1);
  const coords = points.map((point, index) => ({
    ...point,
    x: 12 + index * step,
    y: 20 + (1 - point.count / max) * 150,
  }));
  const line = coords.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const labels = coords.filter((_, index) => {
    if (coords.length <= 8) return true;
    return index === 0 || index === coords.length - 1 || index % Math.ceil(coords.length / 6) === 0;
  });
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full" role="img" aria-label="Submission trend">
      <line x1="12" y1="170" x2={width - 8} y2="170" className="stroke-border" />
      <path d={line} fill="none" className="stroke-primary" strokeWidth="2" />
      {coords.map(point => (
        <circle key={point.label} cx={point.x} cy={point.y} r="3" className="fill-primary">
          <title>{`${point.label}: ${point.count}`}</title>
        </circle>
      ))}
      {labels.map(point => (
        <text key={`${point.label}-label`} x={point.x} y="196" textAnchor="middle" className="fill-muted-foreground text-[10px]">
          {point.label.slice(5)}
        </text>
      ))}
    </svg>
  );
}

export function BarList({
  items,
  empty,
}: {
  items: Array<{ label: string; count: number }>;
  empty: string;
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(1, ...items.map(item => item.count));
  return (
    <div className="space-y-3">
      {items.map(item => (
        <div key={item.label}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="truncate pr-3">{item.label}</span>
            <span className="tabular-nums text-muted-foreground">{item.count}</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${Math.max(4, (item.count / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
