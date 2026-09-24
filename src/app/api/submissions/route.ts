import { submissionQuery } from '@/lib/rmo/query';
import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { createSubmission, listSubmissions } from '@/services/internal/rmo/submissions';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    return successResponse(await listSubmissions(auth.actor, submissionQuery(request)));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const body = await request.json();
    return successResponse(await createSubmission(auth.actor, body), 201);
  } catch (error) {
    return adminErrorResponse(error);
  }
}
