import { getAuthUser, generateJWT, setAuthCookie } from '@/lib/auth/jwt';
import { prisma } from '@/lib/prisma';
import { scopeForRole, type RmoRoleName } from '@/lib/rmo/access';
import { toSessionClaims } from '@/lib/rmo/session-claims';
import { successResponse, unauthorizedResponse } from '@/lib/utils';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const payload = await getAuthUser(request);
  if (!payload?.userId) return unauthorizedResponse('Authentication is required.');

  const user = await prisma.user.findFirst({
    where: { id: payload.userId, deletedAt: null },
    select: {
      id: true,
      loginId: true,
      email: true,
      name: true,
      role: true,
      rmoRole: true,
      accountStatus: true,
      homeZoneId: true,
      homeDivisionId: true,
      homeLobbyId: true,
      profilePicture: true,
      isOnboarded: true,
      homeZone: { select: { id: true, name: true, code: true } },
      homeDivision: { select: { id: true, name: true, code: true } },
      homeLobby: { select: { id: true, name: true, code: true } },
    },
  });

  if (!user || user.accountStatus === 'DISABLED') {
    return unauthorizedResponse('Authentication is required.');
  }

  await setAuthCookie(await generateJWT(toSessionClaims(user)));

  return successResponse({
    ...user,
    scope: scopeForRole(user.rmoRole as RmoRoleName),
  });
}
