import { adminErrorResponse } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { enrollmentCatalog } from '@/services/internal/rmo/crew-enrollment';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return successResponse(await enrollmentCatalog());
  } catch (error) {
    return adminErrorResponse(error);
  }
}
