import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { previewCrewForm } from '@/services/internal/rmo/question-configurations';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const params = request.nextUrl.searchParams;
    return successResponse(
      await previewCrewForm(auth.actor, {
        crewTypeId: params.get('crewTypeId') ? Number(params.get('crewTypeId')) : undefined,
        dutyTypeId: params.get('dutyTypeId') ? Number(params.get('dutyTypeId')) : undefined,
        registerTypeId: params.get('registerTypeId')
          ? Number(params.get('registerTypeId'))
          : undefined,
      }),
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
