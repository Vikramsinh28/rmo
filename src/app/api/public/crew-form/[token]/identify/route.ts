import { adminErrorResponse } from '@/lib/rmo/guard';
import { clientIp } from '@/lib/rmo/public-request';
import {
  assertPublicBodySize,
  identifyPublicCrew,
} from '@/services/internal/rmo/public-crew-form';
import { successResponse } from '@/lib/utils';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  try {
    assertPublicBodySize(Number(request.headers.get('content-length') || 0));
    const { token } = await context.params;
    const body = await request.json();
    return successResponse(
      await identifyPublicCrew(token, body, clientIp(request)),
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
