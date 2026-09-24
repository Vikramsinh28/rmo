'use client';

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
    data?: T;
  };
  if (!response.ok || body.success === false) {
    throw new Error(body.message || 'Request failed');
  }
  return body.data as T;
}

export function StatusBadge({ status }: { status: string }) {
  const active = status === 'ACTIVE';
  return (
    <span
      className={
        active
          ? 'inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800'
          : 'inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700'
      }
    >
      {active ? 'Active' : 'Disabled'}
    </span>
  );
}
