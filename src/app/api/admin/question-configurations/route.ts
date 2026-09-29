import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import {
  listQuestionConfigurations,
  replaceQuestionConfigurations,
} from '@/services/internal/rmo/question-configurations';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const params = request.nextUrl.searchParams;
    return successResponse(
      await listQuestionConfigurations(auth.actor, {
        crewTypeId: params.get('crewTypeId') ? Number(params.get('crewTypeId')) : undefined,
        dutyTypeId: params.get('dutyTypeId') ? Number(params.get('dutyTypeId')) : undefined,
        formVersionId: params.get('formVersionId')
          ? Number(params.get('formVersionId'))
          : undefined,
        status: params.get('status') || undefined,
      }),
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    return successResponse(
      await replaceQuestionConfigurations(auth.actor, await request.json()),
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
