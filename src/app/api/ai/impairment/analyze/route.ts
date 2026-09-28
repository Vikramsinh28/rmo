import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { RmoError } from '@/lib/rmo/errors';
import { successResponse } from '@/lib/utils';
import { analyzeImpairmentPoc } from '@/services/internal/rmo/impairment-poc';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * INTERNAL / DEVELOPMENT ONLY — Phase 9A impairment POC proxy.
 * Not connected to live WebRTC sessions or the Division Monitor UI.
 */
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
  throw new RmoError('multipart/form-data with field "frame" is required.', 400, 'INVALID_REQUEST');
}

export async function POST(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const frame = await readFrame(request);
    return successResponse(await analyzeImpairmentPoc(auth.actor, frame));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
