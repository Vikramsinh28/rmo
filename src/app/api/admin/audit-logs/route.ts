import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { listQuery } from '@/lib/rmo/query';
import { successResponse } from '@/lib/utils';
import { listAuditLogs } from '@/services/internal/rmo/administration';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    return successResponse(await listAuditLogs(auth.actor, listQuery(request)));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
