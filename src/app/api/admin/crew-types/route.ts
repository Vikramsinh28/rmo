import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { createCrewType, listCrewTypes } from '@/services/internal/rmo/crew-types';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const activeOnly = request.nextUrl.searchParams.get('activeOnly') === 'true';
    return successResponse(await listCrewTypes({ activeOnly }));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const body = await request.json();
    return successResponse(await createCrewType(auth.actor, body), 201);
  } catch (error) {
    return adminErrorResponse(error);
  }
}
