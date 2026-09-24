import { adminErrorResponse } from '@/lib/rmo/guard';
import { RmoError } from '@/lib/rmo/errors';
import { successResponse } from '@/lib/utils';
import { submitCrewEnrollment } from '@/services/internal/rmo/crew-enrollment';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const length = Number(request.headers.get('content-length') || 0);
    if (length > 100_000) throw new RmoError('Enrollment payload is too large.', 400);
    const body = await request.json();
    return successResponse(await submitCrewEnrollment(body), 201);
  } catch (error) {
    return adminErrorResponse(error);
  }
}
