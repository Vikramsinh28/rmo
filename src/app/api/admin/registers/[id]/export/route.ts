import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { exportRegisterCsv, exportRegisterXlsx } from '@/services/internal/rmo/registers';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function filterFrom(params: URLSearchParams) {
  return {
    search: params.get('search') || undefined,
    dateFrom: params.get('dateFrom') || undefined,
    dateTo: params.get('dateTo') || undefined,
    crewTypeId: params.get('crewTypeId') ? Number(params.get('crewTypeId')) : undefined,
    dutyTypeId: params.get('dutyTypeId') ? Number(params.get('dutyTypeId')) : undefined,
    lobbyId: params.get('lobbyId') ? Number(params.get('lobbyId')) : undefined,
    userId: params.get('userId') ? Number(params.get('userId')) : undefined,
    status: params.get('status') || undefined,
    formId: params.get('formId') ? Number(params.get('formId')) : undefined,
    formVersionId: params.get('formVersionId')
      ? Number(params.get('formVersionId'))
      : undefined,
  };
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
    const filter = filterFrom(params);
    if (params.get('format') === 'csv') {
      const result = await exportRegisterCsv(auth.actor, Number(id), filter);
      return new NextResponse(result.csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${result.filename}"`,
        },
      });
    }
    const result = await exportRegisterXlsx(auth.actor, Number(id), filter);
    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      },
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
