import { runMonitoring } from '@/lib/rmo/monitoring-route';
import { getCallAICapabilities } from '@/services/internal/rmo/ai-entitlement';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return runMonitoring(request, actor => getCallAICapabilities(actor, Number(id)));
}
