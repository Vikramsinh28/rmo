import { generateJWT, getAuthUser, setAuthCookie } from '@/lib/auth/jwt';
import { toSessionClaims } from '@/lib/rmo/session-claims';
import { NextRequest } from 'next/server';
import { internalServerErrorResponse, successResponse, unauthorizedResponse } from '@/lib/utils';
import { getUserById } from '@/services/repositories/user';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const { userId } = (await getAuthUser(request)) || {};

    const user = await getUserById(userId);

    if (!user || user.accountStatus === 'DISABLED') {
      return unauthorizedResponse();
    }

    const serializableUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      profilePicture: user.profilePicture,
      role: user.role,
      rmoRole: user.rmoRole,
      accountStatus: user.accountStatus,
      loginId: user.loginId,
      isOnboarded: user.isOnboarded,
      homeZoneId: user.homeZoneId,
      homeDivisionId: user.homeDivisionId,
      homeLobbyId: user.homeLobbyId,
    };

    const token = await generateJWT(toSessionClaims(user));
    await setAuthCookie(token);

    return successResponse({
      user: serializableUser,
    });
  } catch (error) {
    console.error('Auth error:', error);
    return internalServerErrorResponse();
  }
}
