import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { getDivision, updateDivision } from '@/services/internal/rmo/administration';
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
    return successResponse(await getDivision(auth.actor, Number(id)));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const { id } = await context.params;
    const body = await request.json();
    return successResponse(await updateDivision(auth.actor, Number(id), body));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
