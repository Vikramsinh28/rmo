import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { submissionQuery } from '@/lib/rmo/query';
import { successResponse } from '@/lib/utils';
import { previewSubmissionsExport } from '@/services/internal/rmo/submissions';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const workbook = await previewSubmissionsExport(auth.actor, submissionQuery(request));
    return successResponse({ workbook });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
