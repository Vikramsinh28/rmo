import { RMO_ROLES, scopeForRole } from '@/lib/rmo/access';
import { RmoError } from '@/lib/rmo/errors';
import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const DESCRIPTIONS: Record<(typeof RMO_ROLES)[number], string> = {
  SYSTEM_ADMIN: 'Owns zones, divisions, lobbies, users, roles, and audit logs.',
  SUPER_ADMIN: 'Signs in with system scope. Organization changes are not granted in this milestone.',
  DIVISION_ADMIN: 'Works inside one division.',
  DIVISION_MONITOR: 'Reads one division. Live monitoring comes in a later phase.',
  LOBBY_USER: 'Works inside one lobby.',
  CREW_USER: 'Sees only their own account.',
};

export async function GET(request: NextRequest) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    if (auth.actor.rmoRole !== 'SYSTEM_ADMIN') {
      throw new RmoError('You do not have permission to perform this action.', 403);
    }
    return successResponse(
      RMO_ROLES.map(role => ({
        role,
        scope: scopeForRole(role),
        description: DESCRIPTIONS[role],
      })),
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
