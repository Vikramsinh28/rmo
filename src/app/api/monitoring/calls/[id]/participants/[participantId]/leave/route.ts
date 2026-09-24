import { runMonitoring } from '@/lib/rmo/monitoring-route';
import { leaveCall } from '@/services/internal/rmo/lobby-monitoring';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; participantId: string }> },
) {
  const { id, participantId } = await context.params;
  return runMonitoring(
    request,
    actor => leaveCall(actor, Number(id), Number(participantId)),
  );
}
