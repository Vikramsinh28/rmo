import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { listQuery } from '@/lib/rmo/query';
import { successResponse } from '@/lib/utils';
import { createMaster, listMasters } from '@/services/internal/rmo/master-data';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    return successResponse(await listMasters(auth.actor, 'crewType', listQuery(request)));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    return successResponse(await createMaster(auth.actor, 'crewType', await request.json()), 201);
  } catch (error) {
    return adminErrorResponse(error);
  }
}
