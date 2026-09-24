import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { saveRecordingMedia } from '@/services/internal/rmo/lobby-monitoring';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; recordingId: string }> },
) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const { id, recordingId } = await context.params;
    const bytes = Buffer.from(await request.arrayBuffer());
    return successResponse(
      await saveRecordingMedia(auth.actor, Number(id), Number(recordingId), bytes),
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
