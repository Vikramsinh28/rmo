# RMO phase 2 status

This file records the earlier identity attempt. It is not the current milestone.

The sentence “Kostra and RMO logins are both required to see identity data” is withdrawn. RMO has one login. The current behavior, permissions, and open decisions are in `docs/RMO_PHASE_2_ADMINISTRATION_STATUS.md`.

Identity and organization foundation. Monitoring sessions, WebRTC, cameras, face recognition, visual impairment AI, AI Monitor behavior, forms, and safety events are not implemented.

The production API in `railway-monitor` was edited during this phase and then restored. That repository is production code and stays unchanged. The Sequelize migration, identity routes, organization models, and identity tests were removed from it. Apply nothing from this phase to that database.

## Architecture used

Kostra remains the web shell. `railway-monitor` remains the domain API. Sequelize remains the schema owner. `prisma/schema.prisma` was not changed and no Prisma migration was added.

The existing RMO login is `POST /api/auth/login` with `user_id` and password. It returns a bearer JWT with no expiry and no refresh token. Kostra’s cookie JWT is a different token. The shell stores an RMO access token in a separate HTTP-only cookie, `rmo_access_token`, and forwards it to the new identity routes. Prisma login is still in place. That cutover is described in `docs/RMO_AUTH_INTEGRATION_PLAN.md` and is not done.

Role and permission mapping is in `docs/RMO_RBAC_MATRIX.md`.

## Files added

The identity modules, migration, and tests were removed from `railway-monitor` after they were written. They are not in that repository.

Kostra:

- `docs/RMO_AUTH_INTEGRATION_PLAN.md`
- `docs/RMO_RBAC_MATRIX.md`
- `docs/RMO_PHASE_2_STATUS.md`
- `src/lib/rmo/identity.ts`
- `src/lib/rmo/identity.test.ts`
- `src/app/api/rmo/session/route.ts`
- `src/app/api/rmo/identity/[resource]/route.ts`
- `src/components/organisms/modules/identity/IdentityFoundation.tsx`

## Files changed

`railway-monitor` tracked files were restored to their previous contents: `src/models/index.js`, `src/modules/divisions/division.model.js`, `src/modules/users/user.model.js`, and `src/server.js`.

Kostra:

- `src/app/(dashboard)/overview/page.tsx`
- `src/app/(dashboard)/divisions/page.tsx`
- `src/app/(dashboard)/lobbies/page.tsx`
- `src/app/(dashboard)/crew/page.tsx`
- `src/app/(dashboard)/settings/page.tsx`
- `src/lib/routes/config.ts`
- `src/lib/constants/sidebar-navigation.ts`
- `.env.example`

## Database changes

The migration adds, and does not copy, existing tables:

- `zones` (`id`, `name`, `code`, `status` `ACTIVE` or `DISABLED`)
- `divisions.zone_id` nullable foreign key. The written model asks for `NOT NULL`. Existing divisions have no zone, so the column stays nullable until a backfill is decided.
- `division_modules` (`division_id`, `module`, `enabled_by`, `enabled_at`), unique on `(division_id, module)`
- `users.home_zone_id`, `users.home_division_id`, `users.home_lobby_id`, all nullable
- Role enum values `SYSTEM_ADMIN`, `DIVISION_MONITOR`, `LOBBY_USER`, `CREW_USER`

Existing `users.division_id`, `divisions`, `lobbies`, and `monitor_lobby_access` stay. Existing role rows are not renamed. `MONITOR` is not rewritten to `DIVISION_MONITOR`. `USER` is not rewritten to `LOBBY_USER` or `CREW_USER`.

No `actual_zone_id`, `actual_division_id`, or `actual_lobby_id` columns were added. Those belong on a later monitoring session.

No migration was applied. The migration file was deleted from `railway-monitor`.

## API changes

These routes were added and then removed from `railway-monitor`. They are not on the production API. The Kostra proxy still calls them once `RMO_API_URL` is set: `GET /api/identity/me`, `/roles`, `/organization`, `/divisions`, `/lobbies`, `/users`, and `/modules`.

The intended behavior, for a later change outside that repository, was a bearer check on each of those lookups. A `division_id` or `lobby_id` outside the caller’s scope returns 403. Legacy `MONITOR` lobby lookup still uses active `monitor_lobby_access` rows. `DIVISION_MONITOR` sees every lobby in `users.division_id`. Lobby and crew user lists return only the caller. Home location is loaded from the user row and is not copied from `division_id`.

Existing `/api/divisions`, `/api/lobbies`, and `/api/auth/login` behavior is unchanged.

Kostra proxies:

- `POST /api/rmo/session` logs in to the RMO API and sets `rmo_access_token`
- `DELETE /api/rmo/session` clears that cookie
- `GET /api/rmo/identity/:resource` forwards the bearer token

Both require the existing Kostra shell session. `RMO_API_URL` must point at the RMO API.

## Frontend changes

Overview, divisions, lobbies, crew, and settings load the identity payloads for the connected RMO session. They show a user-id login when that cookie is missing. They do not build operational dashboards.

Kostra’s shell still gates pages with `ADMIN` and `USER`. Divisions, lobbies, and crew are visible to both shell roles. The RMO API, not the sidebar, decides which rows return.

## Authentication changes

No change to RMO token creation. Tokens still have no `exp`. The middleware already rejects an expired token, and that path is tested. Kostra Prisma login, OTP, and logout are unchanged. RMO logout is deleting the shell cookie. There is still no refresh token and no server-side revocation.

## RBAC changes

Scope kinds from the written requirements are enforced on the new identity routes: `system`, `division`, `lobby`, and `self`. Legacy `MONITOR` keeps assignment-list isolation. Legacy `USER` is self-scoped until its mapping is decided. Unknown roles receive 403 with `REQUIREMENT DECISION REQUIRED`.

`VISUAL_IMPAIRMENT_DETECTION` is in the module catalog as behavioral, temporal visual analysis. It is not container or drinking detection, and it does not establish intoxication. No role is granted permission to run it. Whether it requires `LIVE_SESSION` is still a requirement decision. `AI_MONITOR` still records the written dependency on `LIVE_SESSION`. There is no enable or inference route.

## Tests

RMO unit tests were run before the production tree was restored: 21 passed. Those test files are no longer in `railway-monitor`.

Covered: missing token, invalid token, wrong secret, expired token, division isolation, lobby isolation, legacy monitor assignment list, home location versus assignment division, zone to division to lobby linkage, visual impairment catalog wording.

Kostra:

| Check | Result |
| --- | --- |
| `eslint .` | Exit 0. Existing warning in `src/components/ui/data-table.tsx`. |
| `tsc --noEmit` | Exit 0 |
| `jest` | 8 suites, 66 tests, all passed |
| `next build` | Exit 0 |

Unauthenticated requests to `/overview`, `/divisions`, `/lobbies`, `/crew`, and `/settings` redirect to `/login`. `/api/rmo/identity/me` and `/api/rmo/session` return 401.

The RMO connect form was not exercised in a browser. No browser tools were available, and the identity pages need a running RMO API plus `RMO_API_URL`.

## Known limitations

- The Sequelize migration has not been applied in this session.
- `divisions.zone_id` is nullable until existing divisions are assigned a zone.
- RMO access tokens do not expire. The shell cookie is a session cookie.
- The dual-login sentence in earlier drafts is withdrawn. RMO uses one login.
- Existing division and lobby write routes still follow the current role checks, which do not match the written system-admin-only create rules.
- Lobby scope uses `home_lobby_id` because operational location does not exist yet.
- People lists for a division include `division_id` or `home_division_id` in that division. Lobby and crew callers only see themselves.

## Unresolved decisions

- Rename `MONITOR` to `DIVISION_MONITOR`, and `USER` to `LOBBY_USER` or `CREW_USER`.
- Whether `SUPER_ADMIN` keeps the current create-division right or loses it to `SYSTEM_ADMIN` only.
- Who may run or enable `VISUAL_IMPAIRMENT_DETECTION`, and whether it depends on `LIVE_SESSION`.
- Whether a lobby user may list other people at the home lobby.
- Token expiry, refresh, and server-side logout.
- When Prisma login is removed.
- Backfill of `zones` and `divisions.zone_id` for West, East, and Middle.
