import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { importLegacyCrewData } from '@/services/internal/rmo/legacy-import';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const body = await request.json();
    return successResponse(await importLegacyCrewData(auth.actor, body));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
