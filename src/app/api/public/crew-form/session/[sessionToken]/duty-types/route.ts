import { adminErrorResponse } from '@/lib/rmo/guard';
import { clientIp, publicSessionToken } from '@/lib/rmo/public-request';
import { listPublicDutyTypes } from '@/services/internal/rmo/public-crew-form';
import { successResponse } from '@/lib/utils';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionToken: string }> },
) {
  try {
    const { sessionToken: pathToken } = await context.params;
    const token = publicSessionToken(request, pathToken);
    return successResponse({
      items: await listPublicDutyTypes(token, clientIp(request)),
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
