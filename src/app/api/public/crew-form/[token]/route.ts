import { adminErrorResponse } from '@/lib/rmo/guard';
import { clientIp } from '@/lib/rmo/public-request';
import {
  assertPublicBodySize,
  getPublicLobbyFormContext,
} from '@/services/internal/rmo/public-crew-form';
import { successResponse } from '@/lib/utils';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  try {
    assertPublicBodySize(Number(request.headers.get('content-length') || 0));
    const { token } = await context.params;
    return successResponse(await getPublicLobbyFormContext(token, clientIp(request)));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
