export const IST_TIME_ZONE = 'Asia/Kolkata';

function asDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function istParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? '';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Fixed `YYYY-MM-DD HH:mm:ss` in Indian Standard Time (for CSV/XLSX exports). */
export function formatIstDateTime(value: Date | string | null | undefined): string {
  if (value == null) return '';
  const date = asDate(value);
  if (!date) return value === '' ? '' : String(value);
  const p = istParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** Calendar date `YYYY-MM-DD` in Indian Standard Time (date inputs / filters). */
export function formatIstDate(value: Date | string | null | undefined): string {
  if (value == null) return '';
  const date = asDate(value);
  if (!date) return '';
  const p = istParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Locale display string in Indian Standard Time. */
export function formatIstDisplay(
  value: Date | string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (value == null) return '';
  const date = asDate(value);
  if (!date) return '';
  return date.toLocaleString('en-IN', { timeZone: IST_TIME_ZONE, ...options });
}

/** Filename-safe timestamp in IST: `YYYY-MM-DD-HHmmss`. */
export function formatIstFilenameTimestamp(value: Date): string {
  return formatIstDateTime(value).replace(/[: ]/g, m => (m === ' ' ? '-' : ''));
}

/** IST calendar date N days before `from` (defaults to now). */
export function istDaysAgo(days: number, from: Date = new Date()): string {
  const date = new Date(from.getTime() - days * 86400000);
  return formatIstDate(date);
}

/** IST calendar date N months before `from` (defaults to now). */
export function istMonthsAgo(months: number, from: Date = new Date()): string {
  const p = istParts(from);
  const year = Number(p.year);
  const month = Number(p.month) - 1 - months;
  const day = Number(p.day);
  const utcApprox = new Date(Date.UTC(year, month, day, 12, 0, 0));
  return formatIstDate(utcApprox);
}

/**
 * Parse a `datetime-local` / `YYYY-MM-DDTHH:mm[:ss]` value as IST and return UTC ISO.
 * Empty/invalid input returns null.
 */
export function parseIstDateTimeLocal(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s = '0'] = match;
  // IST is UTC+05:30 with no DST — convert wall clock to UTC.
  const utcMs =
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) -
    (5 * 60 + 30) * 60 * 1000;
  const date = new Date(utcMs);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
