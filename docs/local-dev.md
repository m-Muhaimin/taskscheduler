# Local development database

The auth API needs Postgres. There is no Docker on this machine and no
system Postgres, so `apps/api/scripts/local-db.mjs` runs **real Postgres
binaries** via the `embedded-postgres` devDependency — as a normal user
process, no admin rights, no system changes.

## Start it

    npm run db:local --workspace=apps/api

That initialises a cluster in `apps/api/.localdb/` (gitignored) on first run,
then on every run it:

1. starts Postgres on **5432** (foreground — Ctrl+C stops it),
2. creates the `tradescheduler` database if missing,
3. creates the `anon` and `authenticated` roles (see below),
4. applies the migrations listed in `MIGRATIONS` inside the script.

Then start the API with the connection string it prints:

    export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/tradescheduler"
    export JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
    npm run dev --workspace=apps/api

Credentials are `postgres` / `postgres`, database `tradescheduler`. These are
local-only and deliberately trivial.

## Reset

    npm run db:local:reset --workspace=apps/api

Deletes the cluster and rebuilds it from scratch. Destroys all local accounts.

## The JWT secret does not persist

`JWT_SECRET` is re-generated above on every start, so **restarting the API
invalidates every issued token** — signed-in browsers get bounced to `/login`.
That is correct behaviour, but easy to misread as a bug. To keep sessions alive
across restarts, export a fixed value instead.

## Migrations

`MIGRATIONS` in `local-db.mjs` is an explicit allowlist, currently just the auth
migration `004-create-tradespeople-table.sql`. The Step-9 `escalations` and
`conversation_states` DDL are **intentionally skipped** — that work is
incomplete and its schema is still moving, so applying it here would mean
maintaining DDL nobody has approved yet. Add them once that work lands.

## Why `anon` / `authenticated` exist locally

Migration 004 ends with:

    revoke all on public.ts_tradespeople from anon, authenticated;

Those roles are Supabase-specific and don't exist in a stock Postgres, so the
script creates them as `NOLOGIN` roles first. That lets the migration run
**verbatim** — no local-only edit that could drift from the file actually
shipped. The API connects as the `postgres` superuser, so RLS does not restrict
it; the revokes are there to encode intent, not to gate this process.

## Verifying a real sign-in

The browser E2E in `apps/web/tests/` runs against a stub API and needs no
database. To exercise the real stack instead, start all three services and run
a script that drives the UI over CDP — see `apps/web/tests/e2e/cdp-harness.mjs`
for the driver. Registering through the browser at
http://localhost:3100/register is the quickest manual check.
