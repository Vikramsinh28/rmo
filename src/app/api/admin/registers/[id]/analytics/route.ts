import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { registerAnalytics } from '@/services/internal/rmo/registers';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

function optionalInt(params: URLSearchParams, key: string) {
  const raw = params.get(key);
  if (!raw) return undefined;
  return Number(raw);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const { id } = await context.params;
    const params = request.nextUrl.searchParams;
    return successResponse(
      await registerAnalytics(auth.actor, Number(id), {
        search: params.get('search') || undefined,
        dateFrom: params.get('dateFrom') || undefined,
        dateTo: params.get('dateTo') || undefined,
        crewTypeId: optionalInt(params, 'crewTypeId'),
        dutyTypeId: optionalInt(params, 'dutyTypeId'),
        lobbyId: optionalInt(params, 'lobbyId'),
        userId: optionalInt(params, 'userId'),
        status: params.get('status') || undefined,
        formId: optionalInt(params, 'formId'),
        formVersionId: optionalInt(params, 'formVersionId'),
      }),
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
