# Docker and database setup status

Date: 2026-09-24. Work stopped after this foundation. No RBAC, auth migration, organization schema, monitoring sessions, WebRTC, or AI was added.

## 1. Repository verified

- Repository root: `/Users/vikram/Practice/kostra-boilerplate`
- Branch: `main` (`No commits yet on main`)
- Git remote: none
- Every file written for this task is inside that root.

## 2. Protected repositories verified

Read-only. Not modified by this task.

| Repository | `git status --short` after this task |
| --- | --- |
| `railway-monitor` | Only the pre-existing untracked docs: `docs/NEXTJS_REBUILD_SPEC.md`, `docs/PRODUCT_REQUIREMENTS_AND_ARCHITECTURE.md`, `docs/rm.code-workspace` |
| `remote_monitoring_admin_app` | Clean |
| `remote_monitoring_user_app` | Clean |

No production database, Railway service, or production environment file was contacted.

## 3. Docker setup

Root `docker-compose.yml` defines one service, `postgres` (`postgres:16-alpine`, container `rmo-kostra-postgres`). Host port `${POSTGRES_PORT:-5434}` maps to container `5432`. Named volume `postgres_data`. First-time init script `infra/postgres/init-test-db.sql` creates `rmo_kostra_test`.

`docker compose config` and `docker compose up` were not run. On this machine `/usr/local/bin/docker` is a symlink to `/Applications/Docker.app/Contents/Resources/bin/docker`, and Docker.app is not installed. `docker` is not on `PATH`. Podman and Colima are not installed.

The supported local command, once Docker Desktop is installed, remains:

```bash
docker compose up -d postgres
```

`infra/docker-compose.yml` is the older optional app stack. Its database name is `rmo_kostra_dev` and it publishes host port `5435` so it does not take `5434`. Use the root Compose file for day-to-day development.

## 4. PostgreSQL setup

Because Compose could not start, migrations, seed, health, and tests were checked against a temporary Homebrew PostgreSQL 16 on `127.0.0.1:5434`. That process used trust authentication for user `postgres` and data directory `data/pg5434-local` (gitignored). It was not a Docker container.

After verification that process was stopped and `data/pg5434-local` was removed, so port `5434` is free for the Compose container. There is no local database running now.

Databases created for the check:

- `rmo_kostra_dev`
- `rmo_kostra_test`

## 5. Environment setup

`.env.example` documents local values only: user `postgres`, password `postgres`, database `rmo_kostra_dev`, port `5434`. `POSTGRES_URL` points at `127.0.0.1`. A local `.env` was created with those same values. `.env` is gitignored. Production credentials are not in the repository. The production section of `.env.example` says to set secrets on the host.

## 6. Prisma setup

Prisma 7, schema `prisma/schema.prisma`, client output `src/lib/prisma/generated`. The schema is still the existing Kostra SaaS schema. No Railway Monitor domain models were added.

Migrations present:

1. `20250926125853_initital_schema`
2. `20260105065503_email_template_and_campaign_added`

Seed command in `prisma.config.ts` is `node ./node_modules/tsx/dist/cli.mjs prisma/seed.ts`, so `pnpm prisma db seed` does not depend on `tsx` being on `PATH`.

## 7. Migration result

`./node_modules/.bin/prisma migrate deploy` succeeded on both local databases. Each reported 2 migrations applied.

Public tables on `rmo_kostra_dev`:

`Blog`, `BlogCategory`, `Campaign`, `CampaignRecipient`, `Category`, `ContactSubmission`, `CreditHistory`, `EmailOTP`, `EmailTemplate`, `File`, `Package`, `User`, `_prisma_migrations`

`prisma db push` and `prisma migrate reset` were not used. GitHub Actions no longer runs `prisma migrate reset --force`. CI applies `prisma migrate deploy` to its own job database `rmo_kostra_test` on port `5433`.

## 8. Seed result

`pnpm prisma db seed` succeeded against `rmo_kostra_dev`. One row:

| email | role |
| --- | --- |
| `vikramsinhparmar2812@gmail.com` | `SYSTEM_ADMIN` |

Sign-in also accepts user id `sysadmin`. The local password is `Vikram@2812`. The seed throws unless the host is `127.0.0.1` or `localhost` and the database name is `rmo_kostra_dev`. Zones, divisions, lobbies, and crew were not seeded.

## 9. Test database result

Jest `global-setup` and `jest.setup.js` refuse any URL that is not localhost and database `rmo_kostra_test`. Global setup runs `./node_modules/.bin/prisma migrate deploy` on that database only. It does not reset `rmo_kostra_dev`.

A full Jest run (`66` tests, `8` suites) passed against `rmo_kostra_test` while a Next server on `127.0.0.1:3001` used that same URL, `TEST_MODE=true`, and the JWT values from `jest.setup.js`. The agent environment had `SKIP_DB_SETUP=1` for that full run, so that particular invocation skipped migrate. A follow-up run with `SKIP_DB_SETUP` unset connected to `rmo_kostra_test` at `127.0.0.1:5434` and reported no pending migrations.

## 10. Health check result

`GET http://127.0.0.1:3002/api/health` against `rmo_kostra_dev` returned HTTP 200:

```json
{"ok":true,"database":"connected"}
```

The handler runs `SELECT 1`. The response has no URL, user, or password. `/api/health` is public in `src/lib/routes/config.ts`.

## 11. Build result

`next build` then `npm run verify-sitemap` exited 0. `/api/health` is in the route list. Next skipped its own type check because `typescript.ignoreBuildErrors` is set; `tsc --noEmit` was run separately and exited 0. The build printed existing Sentry warnings that `import-in-the-middle` and `require-in-the-middle` are not installed.

## 12. Test result

- `eslint` exit 0, with the existing warning in `src/components/ui/data-table.tsx` (`react-hooks/incompatible-library` on `useReactTable`)
- `tsc --noEmit` exit 0
- `jest --verbose --no-coverage`: 8 suites, 66 tests, all passed

## 13. Files changed

Inside Kostra only:

- `.env.example`
- `.github/workflows/ci.yml`
- `infra/docker-compose.yml`
- `jest.setup.js`
- `package.json`
- `prisma.config.ts`
- `src/lib/routes/config.ts`
- `src/test/global-setup.ts`
- `docs/RMO_LOCAL_DEVELOPMENT.md`

`.env` was created and is gitignored. It is not part of git status.

## 14. Files added

- `docker-compose.yml`
- `infra/postgres/init-test-db.sql`
- `prisma/seed.ts`
- `src/app/api/health/route.ts`
- `docs/RMO_REPOSITORY_SAFETY.md`
- `docs/RMO_KOSTRA_CURRENT_STATE.md`
- `docs/RMO_LOCAL_DEVELOPMENT.md`
- `docs/RMO_EXISTING_SYSTEM_INTEGRATION_GAPS.md`
- `docs/RMO_DOCKER_SETUP_STATUS.md`

The Kostra repository has no commits yet, so `git status` lists the whole tree as untracked, including files that existed before this task.

## 15. Files deleted

None in git. The temporary data directory `data/pg5434-local` was removed after the checks. It was gitignored.

## 16. Unresolved issues

- Docker Desktop is not installed, so the Compose container was not started. Install Docker, then run `docker compose up -d postgres` from the Kostra root. A fresh volume runs `infra/postgres/init-test-db.sql` and creates `rmo_kostra_test`. Then run `pnpm prisma migrate deploy` and `pnpm prisma db seed`.
- The Prisma schema is still the SaaS schema. Organization rows are not seeded.
- Kostra identity pages still proxy to `/api/identity/*`, which is not on the production API. That stays documented in `docs/RMO_EXISTING_SYSTEM_INTEGRATION_GAPS.md`.
- A Next.js process that was already listening on port 3000 was left running. This task started and then stopped servers on ports 3001 and 3002 only.
