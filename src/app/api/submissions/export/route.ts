import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { submissionQuery } from '@/lib/rmo/query';
import { exportSubmissions } from '@/services/internal/rmo/submissions';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const result = await exportSubmissions(auth.actor, submissionQuery(request));
    if (result.kind === 'xlsx') {
      return new NextResponse(new Uint8Array(result.buffer), {
        status: 200,
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="submissions.xlsx"',
        },
      });
    }
    return new NextResponse(result.text, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="submissions.csv"',
      },
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
