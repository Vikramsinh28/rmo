import { runMonitoring } from '@/lib/rmo/monitoring-route';
import { getCall } from '@/services/internal/rmo/lobby-monitoring';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return runMonitoring(request, actor => getCall(actor, Number(id)));
}
