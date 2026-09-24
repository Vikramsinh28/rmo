# RMO Phase 4A — Crew enrollment status

Local only. Railway Monitor, its database, and its APIs were not changed.

## Flow

A person opens `/enroll` without signing in. They enter personal details, a staff number, a requested zone, division, and lobby, any published enrollment-form answers, and a login ID and password they choose. Submit creates a `CrewEnrollment` in `PENDING`. No `User` row exists yet, so the password cannot sign in.

A division admin opens `/enrollments`, reviews the request, and approves or rejects it. Approval is one database transaction: it creates an `ACTIVE` `CREW_USER` in that admin's division, copies the applicant's existing password hash onto the user, writes the form submission for the version they answered, and marks the enrollment `APPROVED`. Rejection stores a reason and does not create a user.

The requested division and lobby are not access. The approving admin confirms the lobby, and may pick a different lobby inside their own division. The role is always `CREW_USER` and is not editable.

## Status

`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`. New requests start at `PENDING`. Rejected rows stay for history. `CANCELLED` is reserved and has no screen yet.

## Password

The applicant chooses the password. It is checked with the existing `validatePassword` rules (8 characters, uppercase, lowercase, number, special character) in the browser and again on the server. The hash is bcrypt via the existing `hashPassword` helper and is stored on the enrollment. Approval copies that hash onto `User.password`. The admin never sets, sees, or receives it. API selects omit `passwordHash`. Audit metadata omits the password and the hash. A division admin cannot reset a `CREW_USER` password from the user directory. After approval the crew signs in with the password they chose. If they later forget it, they use the existing forgot-password flow. There is no separate enrollment reset.

## Data

`CrewEnrollment` stores the identity fields, requested zone, division, and lobby, `loginId`, status, review fields, `createdUserId`, and the password hash. Dynamic questions are not columns. A published form with purpose `CREW_ENROLLMENT` supplies them. The enrollment stores `formId`, `formVersionId`, and the validated answers. Approval creates a `Submission` for that version and stores `formSubmissionId`.

`prisma/seed.ts` creates that published form when it is missing. The local dev database already has one. Re-running the seed also resets the local system-admin password, so prefer leaving the existing admin row alone.

One pending email and one pending login ID are enforced by partial unique indexes.

## Approval and rejection

Only `DIVISION_ADMIN` can approve or reject, and only for `requestedDivisionId` equal to their home division. A lobby outside that division is rejected. `SYSTEM_ADMIN` can list and filter every division by status and date, and can open a review, but cannot approve or reject. `SUPER_ADMIN` has no enrollment permission.

## APIs

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/enrollment/options` | Public |
| POST | `/api/enrollment/crew` | Public |
| GET | `/api/enrollment/crew/:code/status` | Public, by `RMO-ENR-` code |
| GET | `/api/admin/crew-enrollments` | System admin, division admin (own division) |
| GET | `/api/admin/crew-enrollments/:id` | Same |
| POST | `/api/admin/crew-enrollments/:id/approve` | Division admin |
| POST | `/api/admin/crew-enrollments/:id/reject` | Division admin |

The public success payload is the application code, status, requested division name, requested lobby name, and a message. It does not include a database id or a password.

## Login

A matching pending enrollment with the correct password returns "Your crew enrollment is awaiting approval." A rejected one returns "Your crew enrollment was not approved." Any other failure stays "Invalid email or password." Approved crew use the normal login.

## Dashboard

The division summary adds pending enrollments, approved today, rejected today, and crew members in that division. The counts follow `homeDivisionId` / `requestedDivisionId` for the signed-in admin.

## Audit

`crew_enrollment.created`, `crew_enrollment.approved`, `crew_enrollment.rejected`, and `user.created` for the new crew account. Metadata has division, lobby, and ids. It does not have the password, hash, token, or cookie.

## Tests

`src/test/api/rmo/crew-enrollment.test.ts` covers valid submit, invalid email, password, confirmation, required answers, bad division, bad lobby, lobby/division mismatch, duplicate pending, duplicate user, hidden password, Ahmedabad versus Surat visibility, approve, reject, system-admin read without approval, and login for pending, rejected, and approved crew.

`npx tsc --noEmit` passed. The RMO Jest suites passed. The four older auth HTTP suites (`login`, `logout`, `signup`, `verify-signup`) still fail with `AggregateError` because they call `http://localhost:3001`, which is not this app. That failure existed before this phase.

`scripts/phase4a-browser-check.mjs` walks `/enroll` and `/enrollments` in Chrome, then checks Surat visibility and rejection through the API. The local run passed 12 checks: public enroll, hidden password, pending login blocked, division-admin approval, crew login at `/crew` with the chosen password, Surat admin isolation, and a rejected login.

## Unresolved

There is no shared rate limiter in the app. Public submit rejects oversized bodies and duplicate pending identities, and that is the abuse control for now. No email is sent on submit or approval. `CANCELLED` has no action. WebRTC, presence, and live session were not started.
