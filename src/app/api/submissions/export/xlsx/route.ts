import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { submissionQuery } from '@/lib/rmo/query';
import { exportSubmissionsXlsx } from '@/services/internal/rmo/submissions';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const result = await exportSubmissionsXlsx(auth.actor, submissionQuery(request));
    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      },
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
