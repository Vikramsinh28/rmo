import { adminErrorResponse } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { crewEnrollmentStatus } from '@/services/internal/rmo/crew-enrollment';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    return successResponse(await crewEnrollmentStatus(code));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
