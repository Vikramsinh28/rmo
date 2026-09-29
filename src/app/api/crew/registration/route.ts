import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { previewCrewForm } from '@/services/internal/rmo/question-configurations';
import { listActiveMasters } from '@/services/internal/rmo/master-data';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const params = request.nextUrl.searchParams;
    const dutyTypeId = params.get('dutyTypeId') ? Number(params.get('dutyTypeId')) : undefined;
    const [dutyTypes, preview] = await Promise.all([
      listActiveMasters('dutyType'),
      auth.actor.crewTypeId && dutyTypeId
        ? previewCrewForm(auth.actor, {
            crewTypeId: auth.actor.crewTypeId,
            dutyTypeId,
          })
        : Promise.resolve(null),
    ]);
    return successResponse({
      crewTypeId: auth.actor.crewTypeId,
      dutyTypes,
      preview,
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
