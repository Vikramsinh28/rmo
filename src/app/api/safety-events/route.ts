import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { listSafetyEvents } from '@/services/internal/rmo/safety-events';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

function optionalNumber(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const params = request.nextUrl.searchParams;
    return successResponse(await listSafetyEvents(auth.actor, {
      status: params.get('status') || undefined,
      severity: params.get('severity') || undefined,
      divisionId: optionalNumber(params.get('divisionId')),
      lobbyId: optionalNumber(params.get('lobbyId')),
      callId: optionalNumber(params.get('callId')),
    kind: params.get('kind') || undefined,
      search: params.get('search') || undefined,
      dateFrom: params.get('dateFrom') || undefined,
      dateTo: params.get('dateTo') || undefined,
      page: optionalNumber(params.get('page')),
      pageSize: optionalNumber(params.get('pageSize')),
    }));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
