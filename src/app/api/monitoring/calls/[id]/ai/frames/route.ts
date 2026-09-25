import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { ingestCallAIFrame } from '@/services/internal/rmo/ai-processing';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const { id } = await context.params;
    const frame = await request.arrayBuffer();
    return successResponse(await ingestCallAIFrame(auth.actor, Number(id), frame));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
