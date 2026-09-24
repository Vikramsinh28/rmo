import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { Actor } from '@/services/internal/rmo/administration';
import { NextRequest } from 'next/server';

export async function runMonitoring(
  request: NextRequest,
  action: (actor: Actor) => Promise<unknown>,
  status = 200,
) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    return successResponse(await action(auth.actor), status);
  } catch (error) {
    return adminErrorResponse(error);
  }
}
