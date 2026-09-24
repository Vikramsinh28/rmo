export type TrendBucket = 'day' | 'week' | 'month';

export interface TrendPoint {
  label: string;
  count: number;
}

function utcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86400000);
}

function startOfWeek(value: Date): Date {
  const day = utcDay(value);
  const weekday = day.getUTCDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  return addDays(day, -offset);
}

export function trendBucket(from: Date, to: Date): TrendBucket {
  const days = (utcDay(to).getTime() - utcDay(from).getTime()) / 86400000;
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  return 'month';
}

export function seriesKeys(from: Date, to: Date, bucket: TrendBucket): string[] {
  const start = utcDay(from);
  const end = utcDay(to);
  const keys: string[] = [];
  if (bucket === 'day') {
    for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = addDays(cursor, 1)) {
      keys.push(isoDay(cursor));
    }
    return keys;
  }
  if (bucket === 'week') {
    const last = startOfWeek(end);
    for (
      let cursor = startOfWeek(start);
      cursor.getTime() <= last.getTime();
      cursor = addDays(cursor, 7)
    ) {
      keys.push(isoDay(cursor));
    }
    return keys;
  }
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor.getTime() <= last.getTime()) {
    const month = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    keys.push(`${cursor.getUTCFullYear()}-${month}`);
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return keys;
}

export function fillSeries(
  from: Date,
  to: Date,
  counts: ReadonlyMap<string, number>,
): { bucket: TrendBucket; points: TrendPoint[] } {
  const bucket = trendBucket(from, to);
  const points = seriesKeys(from, to, bucket).map(label => ({
    label,
    count: counts.get(label) ?? 0,
  }));
  return { bucket, points };
}

export function bucketKey(value: Date | string, bucket: TrendBucket): string {
  const date = value instanceof Date ? value : new Date(value);
  if (bucket === 'month') return isoDay(utcDay(date)).slice(0, 7);
  if (bucket === 'week') return isoDay(startOfWeek(date));
  return isoDay(utcDay(date));
}
