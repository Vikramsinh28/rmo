import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { listRegisterEntries } from '@/services/internal/rmo/registers';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

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
      await listRegisterEntries(auth.actor, Number(id), {
        search: params.get('search') || undefined,
        dateFrom: params.get('dateFrom') || undefined,
        dateTo: params.get('dateTo') || undefined,
        page: params.get('page') ? Number(params.get('page')) : undefined,
        pageSize: params.get('pageSize') ? Number(params.get('pageSize')) : undefined,
      }),
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
