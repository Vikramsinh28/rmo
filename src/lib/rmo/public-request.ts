import { NextRequest } from 'next/server';

export function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || null;
  return request.headers.get('x-real-ip');
}

export function publicSessionToken(request: NextRequest, pathToken?: string): string {
  const header = request.headers.get('x-public-session');
  if (header?.trim()) return header.trim();
  const auth = request.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return (pathToken || '').trim();
}
