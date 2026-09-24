# Local development

Kostra runs on the host. PostgreSQL runs in Docker. The database is local. It is not the Railway Monitor database.

## Start the database

From the Kostra repository root:

```bash
docker compose up -d postgres
docker compose ps
docker compose logs postgres
```

Host port `5434` maps to PostgreSQL in the container. The development database name is `rmo_kostra_dev`. A fresh volume also creates `rmo_kostra_test` for Jest.

Data is stored in the named volume `postgres_data`. `docker compose down` keeps that volume. Remove it only when you intend to delete the local data:

```bash
docker compose down -v
```

That removes the Kostra Compose volume for this project. It does not connect to Railway Monitor.

## Environment

```bash
cp .env.example .env
```

`.env` is gitignored. `POSTGRES_URL` must stay on `127.0.0.1` and database `rmo_kostra_dev`.

## Migrations

Apply the existing Prisma migrations to a fresh local database:

```bash
pnpm prisma migrate deploy
```

When you change `prisma/schema.prisma` during later Kostra work:

```bash
pnpm prisma migrate dev
```

Do not run `prisma migrate reset` or `prisma db push` against a database whose name is not the local development or test database.

## Seed

```bash
pnpm prisma db seed
```

The seed creates one local system administrator:

| User ID | Email | Password | Role |
| --- | --- | --- | --- |
| `sysadmin` | `vikramsinhparmar2812@gmail.com` | `Vikram@2812` | `SYSTEM_ADMIN` |

The seed refuses to run unless `POSTGRES_URL` is `127.0.0.1` or `localhost` and the database name is `rmo_kostra_dev`.

Zones, divisions, lobbies, and crew are not seeded. That organization schema is not in this Prisma schema. It will be seeded only after a later Kostra design adds it, and still only with fictional local rows.

## Application

```bash
pnpm dev
```

Health check:

```bash
curl http://localhost:3000/api/health
```

A successful response is `{"ok":true,"database":"connected"}`. It does not include the database URL or credentials.

## Tests

Jest uses `rmo_kostra_test` on `127.0.0.1:5434` unless `TEST_DATABASE_URL` names that same database on localhost. Global setup applies migrations with `prisma migrate deploy`. It does not reset the development database.

```bash
pnpm test
```

Auth HTTP tests also need the app on port 3001 (`TEST_APP_URL`). Start that server against the test database, with the same JWT values Jest sets, and with `TEST_MODE=true` so signup uses the test email driver:

```bash
TEST_MODE=true \
JWT_SECRET=test-jwt-secret-key-for-testing-only \
JWT_KEY=auth-token \
POSTGRES_URL="postgresql://postgres:postgres@127.0.0.1:5434/rmo_kostra_test?schema=public" \
pnpm exec next start -p 3001 -H 127.0.0.1
```

Jest refuses any `TEST_DATABASE_URL` that is not localhost and `rmo_kostra_test`. Leave `SKIP_DB_SETUP` unset so global setup runs `prisma migrate deploy` on that database only.

## Stop

```bash
docker compose down
```
