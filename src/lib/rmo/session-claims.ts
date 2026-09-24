import { JWTPayload } from '@/lib/auth/jwt';
import { scopeForRole, type RmoRoleName } from '@/lib/rmo/access';

interface SessionUser {
  id: number;
  email: string;
  role: string;
  name: string;
  profilePicture?: string | null;
  isOnboarded: boolean;
  credits?: number | null;
  plan?: string | null;
  isOverDue?: boolean | null;
  planExpiringAt?: Date | null;
  googleId?: string | null;
  stripeCustomerId?: string | null;
  rmoRole: RmoRoleName;
  accountStatus: string;
  loginId?: string | null;
  homeZoneId?: number | null;
  homeDivisionId?: number | null;
  homeLobbyId?: number | null;
}

export function toSessionClaims(user: SessionUser): JWTPayload {
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    profilePicture: user.profilePicture || undefined,
    isOnboarded: user.isOnboarded,
    credits: user.credits || 0,
    plan: user.plan || 'FREE',
    isOverdue: user.isOverDue || false,
    planExpiringAt: user.planExpiringAt?.toISOString(),
    googleId: user.googleId || '',
    stripeCustomerId: user.stripeCustomerId || undefined,
    rmoRole: user.rmoRole,
    accountStatus: user.accountStatus,
    loginId: user.loginId || undefined,
    homeZoneId: user.homeZoneId ?? null,
    homeDivisionId: user.homeDivisionId ?? null,
    homeLobbyId: user.homeLobbyId ?? null,
    scope: scopeForRole(user.rmoRole),
  };
}
