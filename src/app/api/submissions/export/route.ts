import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { submissionQuery } from '@/lib/rmo/query';
import { exportSubmissions } from '@/services/internal/rmo/submissions';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const csv = await exportSubmissions(auth.actor, submissionQuery(request));
    return new NextResponse(csv, {
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
