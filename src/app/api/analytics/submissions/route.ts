import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { submissionQuery } from '@/lib/rmo/query';
import { successResponse } from '@/lib/utils';
import { submissionAnalytics } from '@/services/internal/rmo/analytics';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    return successResponse(await submissionAnalytics(auth.actor, submissionQuery(request)));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
