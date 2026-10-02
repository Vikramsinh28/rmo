import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { seedClientForms } from '@/services/internal/rmo/seed-client-forms';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    return successResponse(
      await seedClientForms(auth.actor, {
        divisionId: body?.divisionId != null ? Number(body.divisionId) : undefined,
      }),
      201,
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
