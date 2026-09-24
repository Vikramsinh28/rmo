# Kostra current state

Recorded before the local Docker database setup. Kostra is the only repository that will be changed.

## Stack

| Item | Current value |
| --- | --- |
| Framework | Next.js 16 App Router (`next` 16.0.10) |
| Language | TypeScript |
| Node | `>=22` in `package.json`, `.nvmrc` is `22` |
| Package manager | pnpm (`pnpm-lock.yaml`). A `package-lock.json` is also present. |
| UI | Tailwind, shared components, Zustand auth store |
| Database client | Prisma 7 with the PostgreSQL driver adapter. Schema file: `prisma/schema.prisma`. Client output: `src/lib/prisma/generated`. |
| Migrations | Two SQL migrations under `prisma/migrations`. |
| Auth | Email, password, and OTP against the Prisma `User` model. Cookie JWT (`jose`). Roles stored today: `ADMIN` and `USER`. |
| Tests | Jest. Auth tests call a running app. `jest.setup.js` pointed at `127.0.0.1:5433/kostra_test`. Global setup ran `prisma db push --force-reset` against `POSTGRES_URL`. |

## Prisma

The schema is the existing Kostra SaaS schema: users, files, packages, blogs, campaigns, credits, and Stripe fields. It is not the Railway Monitor domain schema. Sequelize remains the owner of that production schema, and this repository does not copy it.

`prisma.config.ts` reads `POSTGRES_URL`. Scripts: `pnpm migrate` (`prisma migrate dev`), `pnpm migrate:prod` (`prisma migrate deploy`), `pnpm seed` (`prisma db seed`). No `prisma/seed.ts` existed.

## Routes

Public `/` redirects to `/login`. Dashboard placeholders: overview, divisions, lobbies, crew, monitoring, forms, devices, safety events, settings. Auth and file APIs remain. There was no database health route.

## Docker before this setup

`infra/docker-compose.yml` started Postgres 16 as database `kostra` on host port 5434, with a bind-mounted data directory, plus an application container. `.env.example` pointed `POSTGRES_URL` at `127.0.0.1:5432/kostra`. There was no root `docker compose` file, no named volume for the development database, and no separate documented test database named for this RMO shell.

## Missing local infrastructure

- A root Compose file whose commands match local development
- A local database name that cannot be confused with Railway production
- A seed limited to a development account
- A health check that proves Kostra can query PostgreSQL
- A test database workflow that refuses to reset any database other than the local test database
