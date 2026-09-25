import { runMonitoring } from '@/lib/rmo/monitoring-route';
import { getMyDivisionAICapabilities } from '@/services/internal/rmo/ai-entitlement';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return runMonitoring(request, actor => getMyDivisionAICapabilities(actor));
}
