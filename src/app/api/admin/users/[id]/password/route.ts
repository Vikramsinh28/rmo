import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { resetUserPassword } from '@/services/internal/rmo/administration';
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
    await resetUserPassword(auth.actor, Number(id), String(body.password || ''));
    return successResponse({ message: 'Password reset.' });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
