import {
  canAccessDivision,
  canAccessLobby,
  canAccessUser,
  canAssignRole,
  homePathForRole,
  locationRequirement,
  scopeForRole,
  validateRoleLocation,
} from '@/lib/rmo/access';

describe('RMO access rules', () => {
  it('maps each role to one scope', () => {
    expect(scopeForRole('SYSTEM_ADMIN')).toBe('system');
    expect(scopeForRole('SUPER_ADMIN')).toBe('system');
    expect(scopeForRole('DIVISION_ADMIN')).toBe('division');
    expect(scopeForRole('DIVISION_MONITOR')).toBe('division');
    expect(scopeForRole('LOBBY_USER')).toBe('lobby');
    expect(scopeForRole('CREW_USER')).toBe('self');
  });

  it('routes each role to its dashboard', () => {
    expect(homePathForRole('SYSTEM_ADMIN')).toBe('/overview');
    expect(homePathForRole('SUPER_ADMIN')).toBe('/overview');
    expect(homePathForRole('DIVISION_ADMIN')).toBe('/monitoring');
    expect(homePathForRole('DIVISION_MONITOR')).toBe('/monitoring');
    expect(homePathForRole('LOBBY_USER')).toBe('/lobbies');
    expect(homePathForRole('CREW_USER')).toBe('/crew');
  });

  it('shows location fields only for the selected role', () => {
    expect(locationRequirement('SYSTEM_ADMIN')).toBe('none');
    expect(locationRequirement('SUPER_ADMIN')).toBe('none');
    expect(locationRequirement('DIVISION_ADMIN')).toBe('division');
    expect(locationRequirement('DIVISION_MONITOR')).toBe('division');
    expect(locationRequirement('LOBBY_USER')).toBe('lobby');
    expect(locationRequirement('CREW_USER')).toBe('lobby');
  });

  it('rejects privilege escalation and cross-scope assignment', () => {
    expect(canAssignRole('LOBBY_USER', 'SYSTEM_ADMIN')).toBe(false);
    expect(canAssignRole('DIVISION_ADMIN', 'SYSTEM_ADMIN')).toBe(false);
    expect(canAssignRole('DIVISION_ADMIN', 'DIVISION_ADMIN')).toBe(false);
    expect(canAssignRole('DIVISION_ADMIN', 'LOBBY_USER')).toBe(true);
    expect(canAssignRole('DIVISION_ADMIN', 'CREW_USER')).toBe(true);
    expect(canAssignRole('SUPER_ADMIN', 'SYSTEM_ADMIN')).toBe(false);
    expect(canAssignRole('SUPER_ADMIN', 'CREW_USER')).toBe(false);
    expect(canAssignRole('SYSTEM_ADMIN', 'SUPER_ADMIN')).toBe(true);
    expect(canAssignRole('SYSTEM_ADMIN', 'CREW_USER')).toBe(true);
  });

  it('keeps division and lobby access inside the actor scope', () => {
    const ahmedabad = { rmoRole: 'DIVISION_ADMIN' as const, homeDivisionId: 1 };
    expect(canAccessDivision(ahmedabad, 1)).toBe(true);
    expect(canAccessDivision(ahmedabad, 2)).toBe(false);
    expect(canAccessLobby(ahmedabad, { id: 9, divisionId: 2 })).toBe(false);
    expect(canAccessLobby(ahmedabad, { id: 4, divisionId: 1 })).toBe(true);

    const lobby = { rmoRole: 'LOBBY_USER' as const, homeLobbyId: 4, homeDivisionId: 1 };
    expect(canAccessLobby(lobby, { id: 4, divisionId: 1 })).toBe(true);
    expect(canAccessLobby(lobby, { id: 5, divisionId: 1 })).toBe(false);

    expect(
      canAccessUser(
        { id: 10, rmoRole: 'DIVISION_ADMIN', homeDivisionId: 1 },
        { id: 11, homeDivisionId: 2 },
      ),
    ).toBe(false);
    expect(
      canAccessUser({ id: 10, rmoRole: 'CREW_USER', homeDivisionId: 1 }, { id: 11, homeDivisionId: 1 }),
    ).toBe(false);
    expect(canAccessUser({ id: 10, rmoRole: 'CREW_USER' }, { id: 10 })).toBe(true);
  });

  it('rejects an inconsistent hierarchy', () => {
    expect(
      validateRoleLocation('DIVISION_ADMIN', { homeZoneId: 1, homeDivisionId: 2 }, {
        zoneId: 1,
        divisionId: 2,
        divisionZoneId: 9,
      }),
    ).toBe('Division does not belong to the selected zone.');
    expect(
      validateRoleLocation('LOBBY_USER', { homeZoneId: 1, homeDivisionId: 2, homeLobbyId: 3 }, {
        zoneId: 1,
        divisionId: 2,
        divisionZoneId: 1,
        lobbyId: 3,
        lobbyDivisionId: 8,
      }),
    ).toBe('Lobby does not belong to the selected division.');
    expect(
      validateRoleLocation('SYSTEM_ADMIN', { homeDivisionId: 2 }, {}),
    ).toBe('System roles do not take a division or lobby assignment.');
    expect(
      validateRoleLocation('DIVISION_ADMIN', { homeZoneId: 1, homeDivisionId: 2 }, {
        zoneId: 1,
        divisionId: 2,
        divisionZoneId: 1,
      }),
    ).toBeNull();
  });
});
