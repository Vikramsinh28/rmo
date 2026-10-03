import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { createDutyType, listDutyTypes } from '@/services/internal/rmo/duty-types';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const activeOnly = request.nextUrl.searchParams.get('activeOnly') === 'true';
    return successResponse(await listDutyTypes({ activeOnly }));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const body = await request.json();
    return successResponse(await createDutyType(auth.actor, body), 201);
  } catch (error) {
    return adminErrorResponse(error);
  }
}
