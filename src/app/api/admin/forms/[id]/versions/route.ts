import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { createFormVersion } from '@/services/internal/rmo/forms';
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
    const body = await request.json().catch(() => ({}));
    return successResponse(await createFormVersion(auth.actor, Number(id), body), 201);
  } catch (error) {
    return adminErrorResponse(error);
  }
}
