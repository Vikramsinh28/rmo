type AiLogFields = Record<string, string | number | boolean | null | undefined>;

/** Structured Phase 6 AI logs. Never include tokens, passwords, or frame bytes. */
export function aiLog(
  event: string,
  fields: AiLogFields = {},
  level: 'info' | 'warn' | 'error' = 'info',
) {
  const payload = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value === null ? 'null' : String(value)}`)
    .join(' ');
  const line = payload ? `[rmo-ai] ${event} ${payload}` : `[rmo-ai] ${event}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}
