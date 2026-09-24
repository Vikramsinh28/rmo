import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { listQuery } from '@/lib/rmo/query';
import { successResponse } from '@/lib/utils';
import { createForm, listForms } from '@/services/internal/rmo/forms';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    return successResponse(await listForms(auth.actor, listQuery(request)));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const body = await request.json();
    return successResponse(await createForm(auth.actor, body), 201);
  } catch (error) {
    return adminErrorResponse(error);
  }
}
