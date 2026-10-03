import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { listRegisterQuestionOptions } from '@/services/internal/rmo/registers';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const params = request.nextUrl.searchParams;
    return successResponse(
      await listRegisterQuestionOptions(auth.actor, {
        divisionId: params.get('divisionId') ? Number(params.get('divisionId')) : undefined,
        crewTypeId: params.get('crewTypeId') ? Number(params.get('crewTypeId')) : undefined,
        dutyTypeId: params.get('dutyTypeId') ? Number(params.get('dutyTypeId')) : undefined,
        formId: params.get('formId') ? Number(params.get('formId')) : undefined,
        formVersionId: params.get('formVersionId')
          ? Number(params.get('formVersionId'))
          : undefined,
      }),
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
