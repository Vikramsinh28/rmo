import { runMonitoring } from '@/lib/rmo/monitoring-route';
import { stopRecording } from '@/services/internal/rmo/lobby-monitoring';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; recordingId: string }> },
) {
  const { id, recordingId } = await context.params;
  return runMonitoring(
    request,
    actor => stopRecording(actor, Number(id), Number(recordingId)),
  );
}
