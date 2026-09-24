import { RmoError } from '@/lib/rmo/errors';
import { runMonitoring } from '@/lib/rmo/monitoring-route';
import { setCallConnection } from '@/services/internal/rmo/lobby-monitoring';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const state = body?.state;
  return runMonitoring(request, actor => {
    if (state !== 'RECONNECTING' && state !== 'CONNECTED' && state !== 'FAILED') {
      throw new RmoError('Connection state is not valid.', 400);
    }
    return setCallConnection(actor, Number(id), state, body?.unrecoverable === true);
  });
}
