import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { listDutyTypes } from '@/services/internal/rmo/duty-types';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const items = await listDutyTypes({ activeOnly: true });
    return successResponse(items.map(item => ({
      id: item.id,
      code: item.code,
      name: item.name,
    })));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
