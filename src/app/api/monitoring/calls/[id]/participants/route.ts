import { runMonitoring } from '@/lib/rmo/monitoring-route';
import { joinCall, listParticipants } from '@/services/internal/rmo/lobby-monitoring';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return runMonitoring(request, actor => listParticipants(actor, Number(id)));
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return runMonitoring(request, actor => joinCall(actor, Number(id)), 201);
}
