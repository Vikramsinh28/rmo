import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, database: 'connected' });
  } catch {
    return NextResponse.json({ ok: false, database: 'unavailable' }, { status: 503 });
  }
}
