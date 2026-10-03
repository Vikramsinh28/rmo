import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { renderLobbyQrPng } from '@/services/internal/rmo/lobby-qr';
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
    const png = await renderLobbyQrPng(auth.actor, Number(id));
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'Content-Disposition': `inline; filename="lobby-${id}-crew-form-qr.png"`,
      },
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
