import { adminErrorResponse } from '@/lib/rmo/guard';
import { clientIp, publicSessionToken } from '@/lib/rmo/public-request';
import {
  assertPublicBodySize,
  submitPublicCrewForm,
} from '@/services/internal/rmo/public-crew-form';
import { successResponse } from '@/lib/utils';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ sessionToken: string }> },
) {
  try {
    assertPublicBodySize(Number(request.headers.get('content-length') || 0));
    const { sessionToken: pathToken } = await context.params;
    const token = publicSessionToken(request, pathToken);
    const body = await request.json();
    return successResponse(
      await submitPublicCrewForm(token, body, clientIp(request)),
      201,
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
