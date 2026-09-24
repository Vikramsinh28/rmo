import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { openRecordingFile } from '@/services/internal/rmo/lobby-monitoring';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const { id } = await context.params;
    const file = await openRecordingFile(auth.actor, Number(id));
    const play = request.nextUrl.searchParams.get('play') === '1';
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `${play ? 'inline' : 'attachment'}; filename="recording-${id}${file.extension}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
