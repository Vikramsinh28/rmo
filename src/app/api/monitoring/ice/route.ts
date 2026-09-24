import { monitoringIceServers } from '@/lib/rmo/ice';
import { runMonitoring } from '@/lib/rmo/monitoring-route';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return runMonitoring(request, async () => ({ iceServers: monitoringIceServers() }));
}
