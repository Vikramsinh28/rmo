type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

function limitFor(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function windowMs(): number {
  return limitFor('PUBLIC_FORM_RATE_WINDOW_MS', 60_000);
}

/** Sliding-window rate limiter (in-memory, local-dev friendly). */
export function consumeRateLimit(
  key: string,
  max: number,
  window = windowMs(),
): { allowed: boolean; remaining: number; retryAfterSec: number } {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter(ts => now - ts < window);
  if (bucket.timestamps.length >= max) {
    buckets.set(key, bucket);
    const oldest = bucket.timestamps[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((window - (now - oldest)) / 1000)),
    };
  }
  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return {
    allowed: true,
    remaining: Math.max(0, max - bucket.timestamps.length),
    retryAfterSec: 0,
  };
}

export function publicFormRateLimit() {
  return limitFor('PUBLIC_FORM_RATE_LIMIT', 60);
}

export function publicIdentityAttemptLimit() {
  return limitFor('PUBLIC_IDENTITY_ATTEMPT_LIMIT', 20);
}

export function publicFormMaxBodySize() {
  return limitFor('PUBLIC_FORM_MAX_BODY_SIZE', 100_000);
}

/** Test helper. */
export function resetRateLimits() {
  buckets.clear();
}
