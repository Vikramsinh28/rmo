# RMO Phase 3 — Forms, registers, submissions, and analytics

Date: 2026-09-24. This milestone stays on the local Kostra application and the local databases `rmo_kostra_dev` and `rmo_kostra_test` at `127.0.0.1:5434`. Railway production, the Railway production database, Railway infrastructure, and the `railway-monitor` repository were not changed. Live session, WebRTC, signaling, presence, face recognition, AI monitor, alcohol detection, behavior detection, and safety events were not started.

## Concept mapping

Railway Monitor was read only as a reference. Its forms are one active template per staff type and duty type, with separate question and answer rows. That model conflicts with division-scoped RMO security, so Kostra keeps the RMO role model and stores a versioned schema instead of copying the Railway tables.

| Railway Monitor | Kostra |
| --- | --- |
| `forms` (title, staff type, duty type, active flag) | `Form` with division scope, status `DRAFT` / `PUBLISHED` / `ARCHIVED` |
| `questions` (prompt, field type, options, key, sort order) | Fields inside `FormVersion.schema`. No business questions are hard-coded |
| One mutable active form | Published versions stay unchanged after submissions. A later edit creates a new version |
| `submissions` plus `answers` rows | `Submission` stores `divisionId`, `lobbyId`, `submittedById`, `formId`, `formVersionId`, and answers keyed by field |
| `registers` (name, staff type, duty type) | `Register` scoped to one division and one form, status `ACTIVE` / `INACTIVE` |
| Reporting in the legacy app | `/analytics` with database counts, grouped charts, and CSV export under the same filters |

## Architecture

Pages live under the dashboard shell. Business rules live in `src/services/internal/rmo/`. The browser calls those services through the existing route handlers. Division scope is applied in the query, not by hiding rows in the UI.

| Piece | Location |
| --- | --- |
| Field types and schema validation | `src/lib/rmo/form-schema.ts`, `src/types/form.ts` |
| Trend buckets | `src/lib/rmo/series.ts` |
| Forms | `src/services/internal/rmo/forms.ts` |
| Registers | `src/services/internal/rmo/registers.ts` |
| Submissions and CSV | `src/services/internal/rmo/submissions.ts` |
| Analytics | `src/services/internal/rmo/analytics.ts` |
| Shared submission scope | `src/services/internal/rmo/submission-scope.ts` |
| Screens | `src/components/organisms/modules/forms/` |

Migration `prisma/migrations/20260924150000_rmo_forms_registers` is applied to `rmo_kostra_dev` and `rmo_kostra_test` only.

## Form model

`Form` stores `id`, `name`, `description`, `divisionId` (null only for an explicit system-wide form), `status`, `currentVersionId`, `createdById`, `createdAt`, and `updatedAt`.

A division admin’s create and update calls use `User.homeDivisionId`. A body `divisionId` that does not match that session division returns 403. The list query also filters `divisionId` to the session division.

## Form versioning

`FormVersion` stores `id`, `formId`, `versionNumber`, `schema`, `status` (`DRAFT`, `PUBLISHED`, `SUPERSEDED`), `createdById`, and `createdAt`.

The schema is a JSON document of sections and fields. Each field has `id`, `key`, `label`, `type`, `required`, `placeholder`, `helpText`, `options`, `validation`, `displayOrder`, and `section`.

Supported types: `TEXT`, `TEXTAREA`, `NUMBER`, `DATE`, `DATETIME`, `TIME`, `SINGLE_SELECT`, `MULTI_SELECT`, `YES_NO`, `CHECKBOX`, `RADIO`, `FILE`, `SIGNATURE`.

Saving a published form does not rewrite the published schema. If that version has no open draft, the save creates the next draft. Publish marks the draft `PUBLISHED`, marks the previous published version `SUPERSEDED`, and points `currentVersionId` at the new version. Submissions keep the `formVersionId` they were created with, so the detail page renders that version’s fields.

## Registers

`Register` stores `id`, `name`, `description`, `divisionId`, `formId`, `status`, `createdById`, `createdAt`, and `updatedAt`.

The form must belong to the same division. Enabling and disabling write `register.enabled` and `register.disabled`. The register screen links to `/submissions?registerId=`.

## Submissions

`Submission` stores `id`, `formId`, `formVersionId`, `divisionId`, `lobbyId`, `submittedById`, `submittedAt`, `status` (`PENDING` or `COMPLETED`), and `answers`.

A lobby user or crew user submits a published form assigned to their lobby, or assigned to the whole division. `divisionId` and `lobbyId` are copied from the user row at submit time. A body value that names another division or lobby returns 403. Answers are checked again on the server with the same rules the form screen uses.

`/submissions` filters by form, register, lobby, user, date range, status, and, for a system admin, division. The list is paginated in the database (`page` and `pageSize`, maximum 50).

## Role permissions

Server handlers enforce these rules. The route map in `src/lib/routes/config.ts` is only the first gate.

| Role | Forms | Registers | Submissions | Analytics and CSV |
| --- | --- | --- | --- | --- |
| `SYSTEM_ADMIN` | All divisions, including an explicit system-wide form | All divisions | All divisions, with a division filter | All divisions |
| `DIVISION_ADMIN` | Create, edit, publish, archive, and assign inside the session division | Same division | Same division | Same division |
| `DIVISION_MONITOR` | Read the session division | Read the session division | Read the session division | No analytics or export |
| `LOBBY_USER` | Published forms assigned to their lobby or division | No register administration | Submit assigned forms and read that lobby’s submissions | No |
| `CREW_USER` | Published forms assigned to their lobby or division | No | Submit assigned forms and read only their own submissions | No |

`SUPER_ADMIN` is not an organization administrator in the current RMO model, and these routes do not treat that role as a system admin.

## Division isolation

List, get, export, and analytics queries set `divisionId` from the authenticated user for every role except `SYSTEM_ADMIN`. A query or body `divisionId` for another division returns 403 before the read. A non-numeric value such as `divisionId=surat` returns 400. Assigning a form or register to a lobby in another division returns 403.

## APIs

| Method | Path |
| --- | --- |
| GET, POST | `/api/admin/forms` |
| GET, PATCH | `/api/admin/forms/:id` |
| POST | `/api/admin/forms/:id/publish` |
| POST | `/api/admin/forms/:id/archive` |
| POST | `/api/admin/forms/:id/versions` |
| GET, POST | `/api/admin/registers` |
| GET, PATCH | `/api/admin/registers/:id` |
| GET, POST | `/api/submissions` |
| GET, PATCH | `/api/submissions/:id` |
| GET | `/api/submissions/export` |
| GET | `/api/analytics/submissions` |
| GET | `/api/analytics/forms` |
| GET | `/api/analytics/lobbies` |

`PATCH /api/submissions/:id` is the status change behind `submission.updated`. It is limited to system and division admins inside scope.

## Analytics

`/analytics` is limited to the session division for a division admin. A system admin gets every division and a division selector filled from `GET /api/admin/divisions`.

Metrics are `count` queries: total, today, this week, this month, pending, and completed. The same filters apply to those counts, the charts, the submission list, and CSV export. Today, week, and month are UTC windows intersected with the selected range.

The trend is a SQL `date_trunc` aggregation, then empty buckets are filled in. A span of up to 31 days is daily, up to 120 days is weekly, and a longer span is monthly. Last 7 days and last 30 days stay daily. Last 3 months is weekly. The series is not replaced by a single total.

Charts: submission trend, submissions by form, submissions by lobby, and status distribution.

## Export

`GET /api/submissions/export` runs the same scoped query as the list and returns `text/csv`. The browser does not build the file from an unfiltered payload. A division admin export cannot include another division. The export writes `submission.exported` with the filter and row count, not the answer payload. The file is capped at 5,000 rows.

## Audit

Recorded actions: `form.created`, `form.updated`, `form.published`, `form.archived`, `form.version_created`, `register.created`, `register.updated`, `register.enabled`, `register.disabled`, `submission.created`, `submission.updated`, `submission.exported`.

Metadata keeps ids, names, division, and status. It does not store passwords, JWTs, access tokens, answer payloads, or signature images.

## Tests

`./node_modules/.bin/tsc --noEmit` exited 0.

`./node_modules/.bin/jest`: 10 suites passed, 4 suites failed. The failures are the existing live HTTP auth files (`login`, `logout`, `signup`, `verify-signup`). They call `http://localhost:3001` and fail with a connection error. The local app used here is on port 3000. Those four files were already out of the in-process run in Phase 2B.

In-process suites that passed include:

- `src/test/api/rmo/forms-registers.test.ts` — system admin sees every division and can filter. An Ahmedabad division admin sees Ahmedabad forms, registers, and submissions, and receives 403 for Surat records, Surat `divisionId`, Surat export, and a Surat create. A lobby user sees only the assigned form and cannot submit another. A crew user sees only their own submission and receives 403 for another crew member. A published schema stays unchanged after a later edit, and the old submission still renders version 1. Audit rows for the phase actions do not contain the test password or token.
- `src/lib/rmo/form-schema.test.ts` — field validation, and a 7-day trend stays seven points.
- `src/test/api/rmo/division-operations.test.ts`, `src/test/api/rmo/administration.test.ts`, and the existing unit suites.

`npm run build` completed, including the sitemap check.

## Browser results

Headless Chrome signed in through `http://127.0.0.1:3000` after the local dev server was restarted so it loaded the new Prisma client. The script `scripts/phase3-browser-check.mjs` created Phase3 Ahmedabad and Phase3 Surat, lobbies A1, A2, and B1, forms A1, A2, and B1, registers, and submissions, then deleted those rows.

| Check | Result |
| --- | --- |
| Division admin sees Form A1 and Form A2 | PASS |
| Division admin does not see Form B1 | PASS |
| Division admin sees Ahmedabad registers | PASS |
| Division admin does not see the Surat register | PASS |
| Division admin sees Ahmedabad submissions | PASS |
| Division admin does not see the Surat submission | PASS |
| Analytics stays on Ahmedabad forms | PASS |
| CSV export contains the Ahmedabad crew and not the Surat crew | PASS |
| System admin division list includes All divisions, Ahmedabad, and Surat | PASS |
| System admin sees both forms | PASS |
| Filtering to Surat changes the total from 3 to 1 and the form chart to Form B1 | PASS |
| System admin submission list shows both crews | PASS |

## Unresolved

- `FILE` stores the selected file name. It does not upload the file.
- `SIGNATURE` stores a canvas data URL on the submission. It is omitted from the audit log.
- Filter dropdowns use the existing list cap of 50 rows.
- CSV export stops at 5,000 rows.
- Analytics dates are UTC.
- A system-wide form is optional and visible to a system admin. A register still requires a division-scoped form.
- The four auth HTTP suites still target port 3001.
