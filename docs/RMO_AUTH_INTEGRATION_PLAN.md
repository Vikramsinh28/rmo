# RMO authentication integration plan

Kostra stays the web shell. The existing Express API in `railway-monitor` stays the domain system. Sequelize stays the owner of the RMO PostgreSQL schema. This phase does not replace Kostra’s Prisma login.

## Current RMO authentication

Facts from `railway-monitor` as of this phase.

| Topic | Current behavior | Source |
| --- | --- | --- |
| Login | `POST /api/auth/login` with `user_id` and `password` | `src/modules/auth/auth.controller.js` |
| Password check | `bcrypt.compare` against `users.password_hash` | same |
| Password storage | bcrypt hash, cost 10, on create and reset | signup and reset in the same controller |
| Access token | `jwt.sign` payload: `id`, `userId`, `role`, `division_id`, `email`, `name`, `user_id` | `signAccessToken` |
| Expiry | No `expiresIn` and no `exp` claim. The access token does not expire. | `signAccessToken` |
| Refresh | No refresh route and no refresh token | `src/auth/auth.routes.js` |
| Logout | No REST logout. The client drops the bearer token. Socket presence is a separate in-memory map in `src/state/user-sessions.state.js`. | routes and state file |
| Validation | `Authorization: Bearer` via `requireAuth`. Missing token, bad signature, and `TokenExpiredError` return 401. | `src/middleware/auth.middleware.js` |
| Secret | `process.env.JWT_SECRET`, or the demo fallback `demo-secret-key-change-in-production` | auth middleware and controller |
| Account block | `PENDING_APPROVAL` and any status other than `ACTIVE` cannot log in | login controller |
| Forgot / reset | `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`. Reset token is a sha256 hash with a TTL. | auth controller |
| Legacy device JWT | `POST /api/auth/device-token` issues a KIOSK or MONITOR token from a shared secret. Socket auth still accepts that shape. | `src/auth/auth.routes.js`, `src/auth/auth.middleware.js` |
| Roles stored today | `SUPER_ADMIN`, `DIVISION_ADMIN`, `MONITOR`, `USER`. Legacy `ADMIN` is normalized to `SUPER_ADMIN` in memory only. | `src/modules/users/user.model.js`, `src/middleware/rbac.middleware.js` |
| Scope on the token | `division_id` only. No zone, no lobby, no home location. | `signAccessToken` |

Signup creates `USER` accounts. It does not create the six target roles.

## Current Kostra authentication

| Topic | Current behavior |
| --- | --- |
| Login | `POST /api/auth/login` with email and password against the Prisma `User` table |
| Token | Cookie JWT (`jose`), 24 hour expiry, integer user id, role `ADMIN` or `USER` |
| Claims | Include credits, plan, and Stripe fields from the temporary auth schema |
| Storage | HTTP-only cookie. Zustand keeps the user profile, not the token. |

A Kostra cookie is not an RMO bearer token. The secrets, subjects, and role names differ. Sending the Kostra cookie to the RMO API will fail validation.

## How Kostra should authenticate

1. The browser signs in to the RMO API with `user_id` and `password`.
2. The shell stores the RMO `accessToken` in its own HTTP-only cookie, `rmo_access_token`. That cookie is not the Prisma session cookie.
3. Shell routes under `/api/rmo/identity/*` forward `Authorization: Bearer` to the RMO API. The browser does not read the token.
4. Every identity query runs in the RMO process. `requireAuth` rejects a missing, invalid, or expired token. Scope rules reject a division or lobby outside the caller’s scope.
5. Prisma login remains for the existing Kostra tests and the current shell gate until a cutover is approved.

This bridge is not the final migration. The final migration removes the Prisma session as the product login, aligns token expiry, and stops issuing SaaS claims. That cutover stays unapproved.

## Session and logout

RMO has no server-side access-token session to revoke. Logout for the shell deletes `rmo_access_token`. It does not invalidate a token that was copied earlier. Adding expiry and a refresh token is a later decision. The current token has no `exp`, so an “expired token” check is implemented and tested on the middleware, and production login still omits `exp`.

## Home location and the token

The access token still carries `division_id` only. Home zone, home division, and home lobby are read from `users` on each identity request. They are not copied from `division_id`. A later monitoring session will carry `actual_zone_id`, `actual_division_id`, and `actual_lobby_id`. Those columns are not added in this phase.

## What this phase implements

- Identity lookup routes on the RMO API, behind the existing bearer check and the new scope checks.
- A Kostra proxy that logs in to that API and forwards lookup calls.
- Pages that show the RMO user, role, scope, and the rows the API returns.

## What this phase leaves in place

- Prisma `User`, email OTP, and `/api/auth/*` on Kostra.
- Existing `/api/divisions` and `/api/lobbies` behavior, including legacy `MONITOR` lobby assignments.
- Device-token and in-memory register endpoints.
