import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { listQuery } from '@/lib/rmo/query';
import { successResponse } from '@/lib/utils';
import { createDevice, listDevices } from '@/services/internal/rmo/devices';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    return successResponse(await listDevices(auth.actor, listQuery(request)));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const body = await request.json();
    return successResponse(await createDevice(auth.actor, body), 201);
  } catch (error) {
    return adminErrorResponse(error);
  }
}
