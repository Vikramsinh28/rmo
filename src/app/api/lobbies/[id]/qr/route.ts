import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { getLobbyQr, regenerateLobbyQr } from '@/services/internal/rmo/lobby-qr';
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
    return successResponse(await getLobbyQr(auth.actor, Number(id)));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    if (body?.action === 'regenerate') {
      return successResponse(await regenerateLobbyQr(auth.actor, Number(id)));
    }
    return successResponse(await getLobbyQr(auth.actor, Number(id)));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
