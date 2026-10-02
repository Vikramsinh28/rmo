import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { previewRegisterExport } from '@/services/internal/rmo/registers';
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
    const workbook = await previewRegisterExport(auth.actor, Number(id), {
      search: params.get('search') || undefined,
      dateFrom: params.get('dateFrom') || undefined,
      dateTo: params.get('dateTo') || undefined,
    });
    return successResponse({ workbook });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
