# RMO RBAC matrix

Sources, in this order when they agree:

- `railway-monitor/docs/PRODUCT_REQUIREMENTS_AND_ARCHITECTURE.md` section 4 table and section 9.2 scope kinds
- The current API in `railway-monitor` (`requireAuth`, `rbac.middleware.js`, `division-access.middleware.js`)
- Phase 2 instruction: home location is not the operational location, and visual impairment detection is an accepted module

A blank cell in the requirements table is not a grant. Where the written requirements and the current API disagree, the row says so.

`VISUAL_IMPAIRMENT_DETECTION` is behavioral and temporal visual analysis. It is not bottle, glass, can, or drinking detection, and it does not prove alcohol consumption or intoxication.

Frontend route hiding in Kostra is not authorization. The identity API enforces the scope. The shell pages render what that API returns.

## Scope kinds

| Role | Scope | Rule |
| --- | --- | --- |
| `SYSTEM_ADMIN` | `system` | Written: section 9.2 |
| `SUPER_ADMIN` | `system` | Written: section 9.2 |
| `DIVISION_ADMIN` | `division` | Fixed `divisionId` from `users.division_id`. A query division id that differs is denied. |
| `DIVISION_MONITOR` | `division` | Same division lock. Written: sees every lobby in that division, not the old per-lobby list. |
| `LOBBY_USER` | `lobby` | Written: section 9.2. The lobby id is `home_lobby_id` until a session has an operational lobby. |
| `CREW_USER` | `self` | Written: section 9.2. User lists return that account only. |
| `MONITOR` | legacy assignment | Current API. Not one of the six target roles. Mapping to `DIVISION_MONITOR` is REQUIREMENT DECISION REQUIRED. |
| `USER` | legacy self | Current signup role. Mapping to `LOBBY_USER` or `CREW_USER` is REQUIREMENT DECISION REQUIRED. |
| `ADMIN` | none stored | Normalized to `SUPER_ADMIN` only inside the current middleware. The column does not store `ADMIN`. |

`users.division_id` is the current assignment used by division scope. `home_division_id` is not substituted for it.

## Permissions

| Role | Permission | Scope | API enforcement | UI enforcement |
| --- | --- | --- | --- | --- |
| `SYSTEM_ADMIN` | Create or edit a zone | system | REQUIREMENT DECISION REQUIRED for the write API. This phase only lists zones. | No create form |
| `SYSTEM_ADMIN` | Create or edit a division and set its zone | system | REQUIREMENT DECISION REQUIRED for the write API. Existing `POST /api/divisions` still allows `SUPER_ADMIN`, which contradicts the written split. | No create form |
| `SYSTEM_ADMIN` | Create or edit a lobby | system | REQUIREMENT DECISION REQUIRED for the write API. Existing lobby create allows `DIVISION_ADMIN` and `SUPER_ADMIN`. | No create form |
| `SYSTEM_ADMIN` | Reset any password | system | Not implemented in this phase | None |
| `SYSTEM_ADMIN` | Watch every division | system | `GET /api/identity/organization`, `/divisions`, `/lobbies`, `/users` return all rows | Pages show the payload |
| `SYSTEM_ADMIN` | Read the module catalog and division modules | system | `GET /api/identity/modules` | Shown on overview |
| `SUPER_ADMIN` | Watch every division | system | Same identity reads as system admin | Pages show the payload |
| `SUPER_ADMIN` | Create divisions, zones, lobbies, or reset passwords | system | Written table leaves these blank. Existing division create still allows `SUPER_ADMIN`. New identity routes do not grant writes. | No create form |
| `DIVISION_ADMIN` | Watch and list their division, its lobbies, and its assigned people | division | Identity lists lock `division_id` to `users.division_id` | Pages show the payload |
| `DIVISION_ADMIN` | Create crew and lobby logins in the division | division | Not implemented in this phase | None |
| `DIVISION_ADMIN` | Reset a crew or lobby password in the division | division | Not implemented | None |
| `DIVISION_ADMIN` | Publish forms and registers | division | Not this phase | None |
| `DIVISION_ADMIN` | Name cameras and manage devices | division | Not this phase | None |
| `DIVISION_ADMIN` | See submissions for the division | division | Not this phase | None |
| `DIVISION_ADMIN` | Run a live call | division | Written table leaves this blank. Not granted. | None |
| `DIVISION_MONITOR` | Watch every lobby in their division | division | Identity lobby list is every lobby in `users.division_id`. It does not read `monitor_lobby_access`. | Pages show the payload |
| `DIVISION_MONITOR` | Live call, record, see crew name when face detection is on | division, and only if the division has the module | Not this phase. Module row must exist before a later phase may run it. | None |
| `DIVISION_MONITOR` | See submissions and filter by lobby | division | Not this phase | None |
| `LOBBY_USER` | Open the desk for crew sign-on | lobby (`home_lobby_id`) | Not this phase | None |
| `LOBBY_USER` | List other people’s accounts | lobby | REQUIREMENT DECISION REQUIRED. Identity user list returns only self. | Crew page shows that account only |
| `LOBBY_USER` | See cameras for other lobbies | outside home lobby | Denied on identity lobby lookup | Empty or 403 from the API |
| `CREW_USER` | Fill sign-on / sign-off | self, at the operational lobby later | Not this phase | None |
| `CREW_USER` | See own submissions | self | Not this phase | None |
| `CREW_USER` | List other people or other lobbies | outside self / home lobby | Denied | API result only |
| All six roles | Forgot password and change own password | self | Existing forgot/reset stays. Own-password change while logged in is not a new route here. | Kostra still has its own reset flow |
| `MONITOR` | List lobbies | assigned rows in `monitor_lobby_access`, same `division_id` | Existing `/api/lobbies` and identity lobby lookup | Pages show the payload |
| `MONITOR` | See every lobby in the division the way `DIVISION_MONITOR` will | division | REQUIREMENT DECISION REQUIRED. Not applied to legacy `MONITOR`. | None |
| `USER` | Treated as crew or as lobby user | self | REQUIREMENT DECISION REQUIRED. Identity user list returns only self. | Pages show the payload |
| Any role | Run `VISUAL_IMPAIRMENT_DETECTION` | unknown | REQUIREMENT DECISION REQUIRED. The module code exists. No role is granted the action. | Not shown as an action |
| Any role | Enable `VISUAL_IMPAIRMENT_DETECTION` only when `LIVE_SESSION` is on | division | REQUIREMENT DECISION REQUIRED. `AI_MONITOR` does have that written dependency. Visual impairment does not. | None |
| `DIVISION_ADMIN` | Talk on a monitoring call | division | Written: division admin does not talk to lobbies as the job. Not granted. | None |

## Module catalog

Stored per division only when enabled. Cameras, kiosks, and online lobbies are always on and are not rows in `division_modules`.

| Module | In the written paid list | This phase |
| --- | --- | --- |
| `LIVE_SESSION` | Yes | Catalog and `division_modules` value |
| `FACE_DETECTION` | Yes | Catalog and `division_modules` value |
| `FORM_SUBMISSION` | Yes | Catalog and `division_modules` value |
| `AI_MONITOR` | Yes. Cannot be enabled unless `LIVE_SESSION` is already on. | Catalog records that dependency. No enable route in this phase. |
| `VISUAL_IMPAIRMENT_DETECTION` | Not in section 9.3. Accepted by the phase 2 product instruction as behavioral visual analysis. | Catalog and `division_modules` value. No AI implementation. |

## Identity routes added in this phase

All require `Authorization: Bearer`.

| Method and path | Who gets rows |
| --- | --- |
| `GET /api/identity/me` | The caller, including home location and scope |
| `GET /api/identity/roles` | Authenticated caller. Catalog only. |
| `GET /api/identity/modules` | Enabled rows limited to the caller’s scope |
| `GET /api/identity/organization` | Zones visible in scope |
| `GET /api/identity/divisions` | Divisions visible in scope |
| `GET /api/identity/lobbies` | Lobbies visible in scope |
| `GET /api/identity/users` | People visible in scope |

A `division_id` or `lobby_id` query that falls outside the scope returns 403.
