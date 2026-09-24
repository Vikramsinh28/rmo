import { runMonitoring } from '@/lib/rmo/monitoring-route';
import { listQuery } from '@/lib/rmo/query';
import { listMonitoringLobbies } from '@/services/internal/rmo/lobby-monitoring';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return runMonitoring(request, actor => listMonitoringLobbies(actor, listQuery(request)));
}
