export const RMO_ROLES = [
  'SYSTEM_ADMIN',
  'SUPER_ADMIN',
  'DIVISION_ADMIN',
  'DIVISION_MONITOR',
  'LOBBY_USER',
  'CREW_USER',
] as const;

export type RmoRoleName = (typeof RMO_ROLES)[number];

export type ScopeKind = 'system' | 'division' | 'lobby' | 'self';

export interface HomeLocationInput {
  homeZoneId?: number | null;
  homeDivisionId?: number | null;
  homeLobbyId?: number | null;
}

export interface LocationRecords {
  zoneId?: number | null;
  divisionZoneId?: number | null;
  divisionId?: number | null;
  lobbyDivisionId?: number | null;
  lobbyId?: number | null;
}

const ROLE_RANK: Record<RmoRoleName, number> = {
  CREW_USER: 1,
  LOBBY_USER: 2,
  DIVISION_MONITOR: 3,
  DIVISION_ADMIN: 4,
  SUPER_ADMIN: 5,
  SYSTEM_ADMIN: 6,
};

export function isRmoRole(value: string): value is RmoRoleName {
  return (RMO_ROLES as readonly string[]).includes(value);
}

export function scopeForRole(role: RmoRoleName): ScopeKind {
  if (role === 'SYSTEM_ADMIN' || role === 'SUPER_ADMIN') return 'system';
  if (role === 'DIVISION_ADMIN' || role === 'DIVISION_MONITOR') return 'division';
  if (role === 'LOBBY_USER') return 'lobby';
  return 'self';
}

export function locationRequirement(role: RmoRoleName): 'none' | 'division' | 'lobby' {
  const scope = scopeForRole(role);
  if (scope === 'system') return 'none';
  if (scope === 'division') return 'division';
  return 'lobby';
}

export function homePathForRole(role: string | null | undefined): string {
  switch (role) {
    case 'SYSTEM_ADMIN':
    case 'SUPER_ADMIN':
      return '/overview';
    case 'DIVISION_ADMIN':
      return '/monitoring';
    case 'DIVISION_MONITOR':
      return '/monitoring';
    case 'LOBBY_USER':
      return '/monitoring/desk';
    case 'CREW_USER':
      return '/crew';
    default:
      return '/overview';
  }
}

const DIVISION_MANAGED_ROLES: readonly RmoRoleName[] = [
  'DIVISION_MONITOR',
  'LOBBY_USER',
  'CREW_USER',
];

/** Organization structure. Super Admin is not included. */
export function canAdminister(role: RmoRoleName): boolean {
  return role === 'SYSTEM_ADMIN';
}

/** Users inside one division. This does not include organization structure. */
export function canManageDivisionUsers(role: RmoRoleName): boolean {
  return role === 'DIVISION_ADMIN';
}

export function canAssignRole(actorRole: RmoRoleName, targetRole: RmoRoleName): boolean {
  if (actorRole === 'SYSTEM_ADMIN') return ROLE_RANK[actorRole] >= ROLE_RANK[targetRole];
  if (actorRole === 'DIVISION_ADMIN') return DIVISION_MANAGED_ROLES.includes(targetRole);
  return false;
}

export function canChangeOwnRole(actorRole: RmoRoleName): boolean {
  void actorRole;
  return false;
}

export function canAccessDivision(
  actor: { rmoRole: RmoRoleName; homeDivisionId?: number | null },
  divisionId: number,
): boolean {
  if (canAdminister(actor.rmoRole)) return true;
  if (scopeForRole(actor.rmoRole) === 'division') {
    return actor.homeDivisionId === divisionId;
  }
  return false;
}

export function canAccessLobby(
  actor: {
    rmoRole: RmoRoleName;
    homeDivisionId?: number | null;
    homeLobbyId?: number | null;
  },
  lobby: { id: number; divisionId: number },
): boolean {
  if (canAdminister(actor.rmoRole)) return true;
  if (scopeForRole(actor.rmoRole) === 'division') {
    return actor.homeDivisionId === lobby.divisionId;
  }
  if (actor.rmoRole === 'LOBBY_USER') {
    return actor.homeLobbyId === lobby.id;
  }
  return false;
}

export function canAccessUser(
  actor: { id: number; rmoRole: RmoRoleName; homeDivisionId?: number | null },
  target: { id: number; homeDivisionId?: number | null },
): boolean {
  if (actor.id === target.id) return true;
  if (canAdminister(actor.rmoRole)) return true;
  if (actor.rmoRole === 'DIVISION_ADMIN') {
    return actor.homeDivisionId != null && actor.homeDivisionId === target.homeDivisionId;
  }
  return false;
}

export function validateRoleLocation(
  role: RmoRoleName,
  input: HomeLocationInput,
  records: LocationRecords,
): string | null {
  const zoneId = input.homeZoneId ?? null;
  const divisionId = input.homeDivisionId ?? null;
  const lobbyId = input.homeLobbyId ?? null;
  const requirement = locationRequirement(role);

  if (requirement === 'none') {
    if (zoneId || divisionId || lobbyId) {
      return 'System roles do not take a division or lobby assignment.';
    }
    return null;
  }

  if (!zoneId || !divisionId) {
    return 'This role requires a zone and a division.';
  }
  if (!records.zoneId || records.zoneId !== zoneId) {
    return 'Zone was not found.';
  }
  if (!records.divisionId || records.divisionId !== divisionId) {
    return 'Division was not found.';
  }
  if (records.divisionZoneId !== zoneId) {
    return 'Division does not belong to the selected zone.';
  }

  if (requirement === 'division') {
    if (lobbyId) {
      return 'Division roles do not take a lobby assignment.';
    }
    return null;
  }

  if (!lobbyId || !records.lobbyId || records.lobbyId !== lobbyId) {
    return 'This role requires a lobby.';
  }
  if (records.lobbyDivisionId !== divisionId) {
    return 'Lobby does not belong to the selected division.';
  }
  return null;
}
