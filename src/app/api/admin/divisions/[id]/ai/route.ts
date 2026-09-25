import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import {
  getDivisionAIEntitlement,
  updateDivisionAIEntitlement,
} from '@/services/internal/rmo/ai-entitlement';
import { divisionFaceEnrollmentSummary } from '@/services/internal/rmo/face-enrollment';
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
    const divisionId = Number(id);
    const page = await getDivisionAIEntitlement(auth.actor, divisionId);
    return successResponse({
      ...page,
      faceEnrollment: await divisionFaceEnrollmentSummary(divisionId),
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const { id } = await context.params;
    const body = await request.json();
    const divisionId = Number(id);
    const page = await updateDivisionAIEntitlement(auth.actor, divisionId, body);
    return successResponse({
      ...page,
      faceEnrollment: await divisionFaceEnrollmentSummary(divisionId),
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
