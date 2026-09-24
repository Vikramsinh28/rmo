import { runMonitoring } from '@/lib/rmo/monitoring-route';
import { listCallSignals, postCallSignal } from '@/services/internal/rmo/lobby-monitoring';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const after = Number(request.nextUrl.searchParams.get('after') || '0');
  return runMonitoring(request, actor => listCallSignals(actor, Number(id), Number.isFinite(after) ? after : 0));
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  return runMonitoring(request, actor => postCallSignal(actor, Number(id), body), 201);
}
