import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { RmoError } from '@/lib/rmo/errors';
import { successResponse } from '@/lib/utils';
import { recognizeFacesInCall } from '@/services/internal/rmo/face-recognition';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function readFrame(request: NextRequest) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('frame');
    if (!(file instanceof File)) {
      throw new RmoError('A frame image is required.', 400, 'EMPTY_IMAGE');
    }
    return Buffer.from(await file.arrayBuffer());
  }
  const raw = Buffer.from(await request.arrayBuffer());
  if (!raw.length) throw new RmoError('A frame image is required.', 400, 'EMPTY_IMAGE');
  return raw;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const { id } = await context.params;
    const frame = await readFrame(request);
    return successResponse(await recognizeFacesInCall(auth.actor, Number(id), frame));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
