import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { listAuthorizedLobbyQrs } from '@/services/internal/rmo/lobby-qr';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    return successResponse(await listAuthorizedLobbyQrs(auth.actor));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
