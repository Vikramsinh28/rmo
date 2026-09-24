# RMO Phase 2B — Division operations status

Date: 2026-09-24. This milestone stays on the local Kostra application and the local databases `rmo_kostra_dev` and `rmo_kostra_test` at `127.0.0.1:5434`. Railway production, the Railway production database, Railway infrastructure, and the `railway-monitor` repository were not changed. Live session, WebRTC, signaling, presence, face recognition, and AI monitor were not started.

## Division Admin permissions

`DIVISION_ADMIN` is limited to `User.homeDivisionId`. That column is the division scope. There is no separate `users.division_id` column.

The server reads the division from the authenticated session. A `homeDivisionId` in the request body is accepted only when it matches that session division. Another division returns 403.

A Division Admin can:

- Read their division, its lobbies, its users, and devices on those lobbies
- Create, edit, enable, disable, and reset passwords for `DIVISION_MONITOR`, `LOBBY_USER`, and `CREW_USER` in that division
- Create, edit, enable, and disable `CAMERA` and `KIOSK` devices on lobbies in that division

A Division Admin cannot:

- Create `SYSTEM_ADMIN`, `SUPER_ADMIN`, or `DIVISION_ADMIN`
- Change their own role
- Move a user to another division
- Assign a lobby from another division
- Edit a device, stream, or lobby that belongs to another division
- Move a lobby to another division (`PATCH /api/admin/lobbies/:id` remains `SYSTEM_ADMIN`)
- Enable paid modules

`LOBBY_USER` and `CREW_USER` require a lobby in the admin’s division. `DIVISION_MONITOR` must have a null lobby. A missing lobby returns 400. A lobby on a monitor returns 400. A lobby from another division returns 403.

## User management

The Division Admin user screen is `/users`. It lists users in the session division and supports search, role filter, lobby filter, create, edit, enable, disable, and password reset.

Password reset is `POST /api/admin/users/:id/password`. It applies to `DIVISION_MONITOR`, `LOBBY_USER`, and `CREW_USER` in the same division. `SYSTEM_ADMIN`, `SUPER_ADMIN`, and users in another division return 403. The audit row stores `divisionId` and `loginId`. The password is not stored in the audit log.

## Device management

Devices are local Prisma rows. Migration `prisma/migrations/20260924113000_rmo_devices` is applied to `rmo_kostra_dev` and `rmo_kostra_test` only.

`DeviceType` is `CAMERA` or `KIOSK`. DVR, NVR, and Raspberry screens were not added.

| Field | Column |
| --- | --- |
| id | `id` |
| name | `name` |
| device type | `deviceType` |
| lobby | `lobbyId` |
| stream URL | `streamUrl` |
| display order | `displayOrder` |
| configuration | `isActive` (`true` active, `false` disabled) |
| timestamps | `createdAt`, `updatedAt` |

The lobby must belong to the actor’s division. The device name on screen is the stored name.

Configuration (`isActive`) is separate from runtime health. There is no heartbeat table, so a missed heartbeat cannot set `isActive` to false. Lists and the dashboard return `health: null`. The screens show **Health unavailable**. Online and offline counts are not shown.

`/devices` groups devices by lobby and filters by lobby, device type, and configuration. The health filter stays on “Health unavailable”. Actions are edit, enable, and disable. Add Camera and Add Kiosk insert `Device` rows.

Lobby details at `/lobbies/:id` show lobby information, assigned users, cameras, kiosks, and health unavailable. The parent division is read-only for a Division Admin.

## Division dashboard

`/overview` for `DIVISION_ADMIN` reads `GET /api/admin/dashboard` through `divisionSummary`. Counts come from the local database: lobbies, users, active users, disabled users, cameras, and kiosks. Recent activity is audit rows whose metadata `divisionId` matches the session division.

Always-on modules are listed as included: cameras, kiosks, online lobbies. Paid modules are listed read-only as not enabled: live session, face detection, form submission, AI monitor. There is no enable control.

## Navigation

Division Admin sidebar:

- Dashboard
- People → Users
- Lobbies
- Devices → Cameras, Kiosks
- Forms, Registers, Submissions — placeholders labeled “Next phase”

Forms, registers, and submissions have no business logic in this phase.

## API routes

User and lobby routes already existed under `/api/admin`, so this phase extends those handlers. Device routes are new. Division scope still comes from the session.

| Method | Path | Who |
| --- | --- | --- |
| GET, POST | `/api/admin/users` | `SYSTEM_ADMIN`, `DIVISION_ADMIN` |
| GET, PATCH | `/api/admin/users/:id` | `SYSTEM_ADMIN`, `DIVISION_ADMIN` |
| POST | `/api/admin/users/:id/password` | `SYSTEM_ADMIN`, `DIVISION_ADMIN` |
| GET | `/api/admin/lobbies` | division readers, including `DIVISION_ADMIN` |
| GET | `/api/admin/lobbies/:id` | division readers |
| PATCH | `/api/admin/lobbies/:id` | `SYSTEM_ADMIN` |
| GET, POST | `/api/admin/devices` | `SYSTEM_ADMIN`, `DIVISION_ADMIN` |
| PATCH | `/api/admin/devices/:id` | `SYSTEM_ADMIN`, `DIVISION_ADMIN` |
| POST | `/api/admin/devices/:id/enable` | `SYSTEM_ADMIN`, `DIVISION_ADMIN` |
| POST | `/api/admin/devices/:id/disable` | `SYSTEM_ADMIN`, `DIVISION_ADMIN` |
| GET | `/api/admin/dashboard` | signed-in; division roles receive the division summary |

The device check is device → lobby → division → session `homeDivisionId`.

## Audit events

Each row stores actor, action, entity (`targetType` and `targetId`), `metadata.divisionId`, timestamp, and before/after where the action changes a record.

User: `user.created`, `user.updated`, `user.enabled`, `user.disabled`, `user.password_reset`.

Device: `device.created`, `device.updated`, `device.enabled`, `device.disabled`.

Passwords, tokens, and secrets are omitted. A stream URL change is recorded as `streamUrlChanged: true` or `false`. The URL itself is omitted because it can contain credentials.

## Tests

`./node_modules/.bin/tsc --noEmit` exited 0.

`./node_modules/.bin/jest` on the in-process suites: 6 suites, 20 tests, all passed.

- `src/test/api/rmo/division-operations.test.ts` — Ahmedabad users, lobbies, and devices stay inside Ahmedabad. Surat reads, Surat division assignment, Surat lobby assignment, role escalation, self role change, Surat password reset, and Surat device edit return 403. Monitor, lobby user, and crew creation succeed. Camera and kiosk create, edit, disable, and enable succeed.
- `src/test/api/rmo/administration.test.ts` — 6 tests passed.
- `src/lib/rmo/access.test.ts` — 6 tests passed.
- Email, S3, and file-utils unit tests passed.

The four live HTTP auth files (`login`, `logout`, `signup`, `verify-signup`) call `http://localhost:3001`. They were not run. The local application used for the browser check is on port 3000.

`npm run build` (`next build` and sitemap check) completed successfully.

## Browser results

Headless Chrome signed in as the local system admin (`systemadmin`), created an Ahmedabad division and a Surat division with lobbies, users, and cameras, then signed in as the Ahmedabad Division Admin. The temporary rows were deleted from `rmo_kostra_dev` after the walkthrough. The system admin row was left in place.

| Check | Result |
| --- | --- |
| Division dashboard opens at `/overview` | PASS |
| Ahmedabad users visible | PASS |
| Surat users hidden | PASS |
| Ahmedabad lobby visible | PASS |
| Surat lobby hidden | PASS |
| Ahmedabad device visible | PASS |
| Surat device hidden | PASS |
| Health unavailable | PASS |
| Create division monitor | PASS 201 |
| Create lobby user | PASS 201 |
| Create crew user | PASS 201 |
| Create system admin | PASS 403 |
| Create super admin | PASS 403 |
| Create division admin | PASS 403 |
| Create Surat user | PASS 403 |
| Edit Surat device | PASS 403 |
| Assign a device to the Surat lobby | PASS 403 |

## Git

Kostra `main` has the Phase 2B changes, uncommitted. `railway-monitor` has no tracked modifications. Three untracked files were already in that working tree (`docs/NEXTJS_REBUILD_SPEC.md`, `docs/PRODUCT_REQUIREMENTS_AND_ARCHITECTURE.md`, `docs/rm.code-workspace`) and were not edited. Both Flutter apps are clean.

## Unresolved

- Production `MONITOR` and `USER` still have no local role mapping. Authorization uses `rmoRole` only.
- West, East, and Middle zone backfill is still a plan. It was not applied.
- Device health has no source. The UI shows “Health unavailable”.
- The production `railway-monitor` JWT still has no expiry. That repository was not changed.
- The production Sequelize schema was not migrated.
- Forms, registers, submissions, and live session remain the next phase.
