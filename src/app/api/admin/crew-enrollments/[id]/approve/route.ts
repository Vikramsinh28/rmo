import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { approveCrewEnrollment } from '@/services/internal/rmo/crew-enrollment';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const { id } = await context.params;
    const body = await request.json();
    return successResponse(await approveCrewEnrollment(auth.actor, Number(id), body));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
