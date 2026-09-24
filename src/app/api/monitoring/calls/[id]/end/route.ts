import { runMonitoring } from '@/lib/rmo/monitoring-route';
import { endCall } from '@/services/internal/rmo/lobby-monitoring';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const reason = typeof body?.reason === 'string' ? body.reason : undefined;
  return runMonitoring(request, actor => endCall(actor, Number(id), reason));
}
