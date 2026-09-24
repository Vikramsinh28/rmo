import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { getCrewEnrollment } from '@/services/internal/rmo/crew-enrollment';
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
    return successResponse(await getCrewEnrollment(auth.actor, Number(id)));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
