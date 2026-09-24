# RMO administration status

Date: 2026-09-24. This milestone is the local RMO administration console. Live sessions, presence, WebRTC, cameras, face recognition, AWS Rekognition, AI Monitor, visual impairment detection, alcohol or behavior detection, forms, and safety events are not implemented.

## Authentication

There is one login. The screen is `RMO Remote Monitoring` at `/login`.

```text
POST /api/auth/login
  → HTTP-only session cookie
  → GET /api/auth/me
  → rmoRole and scope
  → role landing page
```

The cookie name comes from `JWT_KEY`. It is `httpOnly`, `sameSite=lax`, and expires after 24 hours. The login JSON does not include the token, and the browser script does not store it. `document.cookie` did not contain the session token during the browser test.

`GET /api/auth` and `GET /api/auth/me` issue a new 24-hour cookie when the current cookie is still valid and the account is active. That is the refresh. Logout is `POST /api/auth/logout`, which deletes the cookie. A disabled account fails the database check on the next request, so an old cookie does not keep working.

The production `railway-monitor` JWT is a different token. It still has no expiry. That repository was not changed.

`RMO_API_URL` is not used. This Next.js process is the RMO application for this milestone. It was not pointed at the Railway production API.

## Roles and permissions

| Role | Scope | Allowed in this milestone |
| --- | --- | --- |
| `SYSTEM_ADMIN` | system | Create, update, disable, and enable zones, divisions, and lobbies. Create and edit users. Assign roles and home location. Reset passwords. Read audit logs and settings. |
| `SUPER_ADMIN` | system | Sign in and open the overview. Organization create, update, and disable are refused with 403. No extra permissions were added. |
| `DIVISION_ADMIN` | assigned division | Read that division and its lobbies. Create and edit `DIVISION_MONITOR`, `LOBBY_USER`, and `CREW_USER` inside that division. Cannot create a system admin, move a user to another division, or change their own role. |
| `DIVISION_MONITOR` | assigned division | Read that division and its lobbies. The monitoring page is a placeholder. User administration is refused. |
| `LOBBY_USER` | assigned lobby | Read that lobby. Cannot assign a different lobby. |
| `CREW_USER` | self | Read their own account. The user directory returns 403. |

Location required at creation:

| Role | Zone | Division | Lobby |
| --- | --- | --- | --- |
| `SYSTEM_ADMIN`, `SUPER_ADMIN` | no | no | no |
| `DIVISION_ADMIN`, `DIVISION_MONITOR` | yes | yes, in that zone | no |
| `LOBBY_USER`, `CREW_USER` | yes | yes, in that zone | yes, in that division |

The server checks the parent records. A mismatched zone, division, or lobby is rejected. The browser cannot grant a role or a location by itself.

## Legacy roles

Read from `railway-monitor` `src/modules/users/user.model.js`. No rows were changed.

| Existing value | New role | Decision |
| --- | --- | --- |
| Production `SUPER_ADMIN` | `SUPER_ADMIN` | Same name. Production division-creation rights were not copied. |
| Production `DIVISION_ADMIN` | `DIVISION_ADMIN` | Same name. Production stores `division_id`, not home zone and lobby. |
| Production `MONITOR` | `DIVISION_MONITOR` | Not renamed. |
| Production `USER` | unresolved | Not rewritten to `LOBBY_USER` or `CREW_USER`. |
| Kostra `ADMIN` / `USER` | not an RMO role | The old `User.role` column remains. Authorization uses `rmoRole` only. |

## Organization

```text
Zone → Division → Lobby → User
```

System Admin can create, read, update, disable, and enable each organization record. Codes are unique: zone code globally, division code inside a zone, lobby code inside a division. Disabling keeps the row.

## Database

`railway-monitor` was not modified. The production database was not opened. No new Prisma migration was added in this pass.

The local application database `rmo_kostra_dev` already has `Zone`, `Division`, `Lobby`, and `AuditLog`, plus `User.loginId`, `User.rmoRole`, `User.accountStatus`, and the home location columns, from `prisma/migrations/20260924083000_rmo_administration`. That database is not the Railway database.

Production Sequelize divisions have `id`, `name`, `code`, `description`, and boolean `status`. There is no `zone_id` column and no zones table in the model that was read. Last login is stored here as an audit row `user.signed_in`, not as a new column, so this pass did not need another migration.

A future production change, not written and not applied:

| Object | Change | Reason | Impact |
| --- | --- | --- | --- |
| `zones` | New table | The hierarchy needs a zone | Empty until names are confirmed |
| `divisions.zone_id` | Nullable foreign key first | A division must belong to a zone | Existing rows stay unassigned |
| users home location | New nullable columns | Division and lobby scope | Production `division_id` stays until a reviewed mapping exists |
| role values | No automatic rename | `MONITOR` and `USER` are unresolved | Existing logins keep their current role |

## Zone backfill

West, East, and Middle are the zone names in the written requirements. Bhavnagar is described as a West division and Botad as a lobby in Bhavnagar. Those names were not inserted, and no existing division was assigned a zone. The safe sequence, after approval, is: add nullable `zone_id`, insert the three zones only after the names are confirmed, then set `zone_id` one division at a time when its zone is known.

## APIs

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth`, `GET /api/auth/me`
- `GET/POST /api/admin/zones`, `PATCH /api/admin/zones/:id`
- `GET/POST /api/admin/divisions`, `GET/PATCH /api/admin/divisions/:id`
- `GET/POST /api/admin/lobbies`, `GET/PATCH /api/admin/lobbies/:id`
- `GET/POST /api/admin/users`, `GET/PATCH /api/admin/users/:id`, `POST /api/admin/users/:id/password`
- `GET /api/admin/roles`, `GET /api/admin/audit-logs`, `GET /api/admin/dashboard`

Missing authentication is 401. An authenticated user outside their role or organization is 403.

Audit actions: zone, division, and lobby created, updated, disabled, and enabled; user created, updated, disabled, enabled, role changed, and password reset; sign-in as `user.signed_in`. Passwords and tokens are not written to the log.

## UI

System Admin navigation:

- Dashboard
- Organization: Zones, Divisions, Lobbies
- Access Management: Users, Roles
- System: Audit logs, Settings

The users table shows name, user ID, role, zone, division, lobby, status, last login, and actions for view, edit, enable, disable, and password reset. Dashboard counts and the activity list come from the local database. An empty audit list stays empty.

Each role lands on its own page: System Admin and Super Admin on `/overview`, Division Admin on `/divisions`, Division Monitor on `/monitoring`, Lobby User on `/lobbies`, Crew User on `/crew`.

## Checks

| Check | Result |
| --- | --- |
| `tsc --noEmit` | Exit 0 |
| RMO Jest access and administration tests | 12 tests passed |
| Chrome walkthrough on `http://127.0.0.1:3000` | See below |
| `railway-monitor` git status | Only the three pre-existing untracked docs. No tracked file changed. |

Chrome, signed in as the local system admin:

| Step | Result |
| --- | --- |
| Login screen and system admin overview | Passed |
| Session cookie absent from `document.cookie` | Passed |
| Dashboard cards from the API | Passed |
| Create zone, Ahmedabad and Surat divisions, Vatva lobby | Passed |
| Create Super Admin, Division Admin, Division Monitor, Lobby User, Crew User | Passed |
| Logout back to `/login` | Passed |
| Anonymous `GET /api/admin/zones` | 401 |
| Division Admin sees Ahmedabad and not Surat | Passed |
| Division Admin `GET /api/admin/zones` | 403 |
| Role landing pages | Passed after the post-login redirect used the role home |
| Crew `GET /api/admin/users` | 403 |
| Disabled crew login stays on `/login` | Passed |
| Audit log contains `zone.created` | Passed |

Jest also covers a lobby user blocked from another lobby, a crew user blocked from changing role, a division admin blocked from assigning `SYSTEM_ADMIN`, and a super admin blocked from creating a zone.

The full Kostra HTTP suite was not started on port 3001 during this pass because `npm run dev` is already using the app. The login tests were updated so they expect the cookie and no token in the JSON.

## Unresolved

- Production `MONITOR` and `USER` are not mapped.
- Super Admin has no organization write permission. A read-only organization view was not added.
- West, East, and Middle are not backfilled.
- The production token still has no expiry. The 24-hour cookie applies to this application only.
- Moving the local tables onto an approved Sequelize migration has not started.
