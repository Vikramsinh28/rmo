import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { RmoError } from '@/lib/rmo/errors';
import { successResponse } from '@/lib/utils';
import { enrollMyFace, getMyFaceEnrollment } from '@/services/internal/rmo/face-enrollment';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY = 8_000_000;

async function readSamples(request: NextRequest): Promise<{ samples: Buffer[]; confirmReenroll: boolean }> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const confirmReenroll = form.get('confirmReenroll') === 'true' || form.get('confirmReenroll') === '1';
    const ordered: Buffer[] = [];
    for (let i = 0; i < 5; i += 1) {
      const file = form.get(`sample${i}`);
      if (file instanceof File) {
        ordered.push(Buffer.from(await file.arrayBuffer()));
      }
    }
    return { samples: ordered, confirmReenroll };
  }

  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY) {
    throw new RmoError('Request is too large.', 413, 'IMAGE_TOO_LARGE');
  }
  const confirmReenroll = request.nextUrl.searchParams.get('confirmReenroll') === 'true';
  const raw = Buffer.from(await request.arrayBuffer());
  if (!raw.length) throw new RmoError('At least one face sample is required.', 400, 'EMPTY_IMAGE');
  return { samples: [raw], confirmReenroll };
}

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    return successResponse(await getMyFaceEnrollment(auth.actor));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const { samples, confirmReenroll } = await readSamples(request);
    return successResponse(await enrollMyFace(auth.actor, samples, { confirmReenroll }));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
