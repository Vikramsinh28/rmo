import { getAuthUser } from '@/lib/auth/jwt';
import { prisma } from '@/lib/prisma';
import { RmoError } from '@/lib/rmo/errors';
import { unauthorizedResponse } from '@/lib/utils';
import { NextRequest, NextResponse } from 'next/server';
import { Actor } from '@/services/internal/rmo/administration';

export async function requireActor(
  request: NextRequest,
): Promise<{ actor: Actor } | { response: NextResponse }> {
  const payload = await getAuthUser(request);
  if (!payload?.userId) {
    return { response: unauthorizedResponse('Authentication is required.') };
  }

  const user = await prisma.user.findFirst({
    where: { id: payload.userId, deletedAt: null },
    select: {
      id: true,
      rmoRole: true,
      homeZoneId: true,
      homeDivisionId: true,
      homeLobbyId: true,
      accountStatus: true,
    },
  });

  if (!user || user.accountStatus === 'DISABLED') {
    return { response: unauthorizedResponse('Authentication is required.') };
  }

  return { actor: user };
}

export function adminErrorResponse(error: unknown) {
  if (error instanceof RmoError) {
    return NextResponse.json({ success: false, message: error.message }, { status: error.status });
  }
  console.error(error);
  return NextResponse.json(
    { success: false, message: 'An unexpected error occurred. Please try again.' },
    { status: 500 },
  );
}
