import { runMonitoring } from '@/lib/rmo/monitoring-route';
import { stopCallAIProcessing } from '@/services/internal/rmo/ai-processing';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return runMonitoring(request, actor => stopCallAIProcessing(actor, Number(id)));
}
