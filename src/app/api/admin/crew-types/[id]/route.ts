import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { getMaster, updateMaster } from '@/services/internal/rmo/master-data';
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
    return successResponse(await getMaster(auth.actor, 'crewType', Number(id)));
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
    return successResponse(
      await updateMaster(auth.actor, 'crewType', Number(id), await request.json()),
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
