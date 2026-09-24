import { scopeForRole } from '@/lib/rmo/access';
import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { dashboardSummary, divisionSummary } from '@/services/internal/rmo/administration';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const scope = scopeForRole(auth.actor.rmoRole);
    if (auth.actor.rmoRole === 'SYSTEM_ADMIN') {
      return successResponse(await dashboardSummary(auth.actor));
    }
    if (scope === 'division') {
      return successResponse(await divisionSummary(auth.actor));
    }
    return successResponse({ scope });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
