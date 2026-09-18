/**
 * Local development database — connects to an already-running Postgres
 * (default 5433 at P:/postgres_data), ensures the app database + Supabase
 * roles exist, and applies migrations.
 *
 *   node scripts/local-db.mjs            # ensure DB + apply migrations
 *   node scripts/local-db.mjs --reset    # drop+recreate the tradescheduler DB
 *
 * Defaults:
 *   LOCALDB_PORT     = 5433
 *   LOCALDB_DATA_DIR = P:/postgres_data   (informational; used for logging only)
 *   LOCALDB_DB_USER  = postgres
 *   LOCALDB_DB_PASS  = postgres@1
 *
 * Override any of these via environment variables.
 *
 * This does NOT start its own Postgres process — it expects one to already
 * be running. The embedded-postgres package is kept as a transitive dep only.
 */
import pg from "pg";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const migrationsDir = join(apiRoot, "src", "db", "migrations");

const PORT = Number(process.env.LOCALDB_PORT ?? 5433);
const DB_NAME = "tradescheduler";
const DB_USER = "postgres";
const DB_PASSWORD = "postgres@1";
const DATA_DIR = process.env.LOCALDB_DATA_DIR ?? "P:/postgres_data";

/** All share-ready migrations that should run against a fresh local DB. */
const MIGRATIONS = [
  "001-create-jobs-table.sql",
  "002-create-escalations-table.sql",
  "003-create-conversation-states-table.sql",
  "004-create-tradespeople-table.sql",
  "005-create-ai-usage-table.sql",
  "006-create-organizations-table.sql",
  "007-create-customer-conversation-tables.sql",
  "008-create-appointments-table.sql",
];

/** Supabase defines these roles; creating them keeps the migration verbatim. */
const SUPABASE_ROLES = ["anon", "authenticated"];

const log = (...a) => console.log("[local-db]", ...a);

/** Probe the running Postgres and abort if unreachable. */
async function probe() {
  const client = new pg.Client({ host: "localhost", port: PORT, user: DB_USER, password: DB_PASSWORD, database: "postgres" });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(`cannot connect to postgres on localhost:${PORT} — is it running? ${e instanceof Error ? e.message : e}`);
  } finally {
    await client.end();
  }
  log(`postgres reachable on :${PORT} (data dir: ${DATA_DIR})`);
}

/** Connect to a database and run a statement list. */
async function sql(statements, database = "postgres") {
  const client = new pg.Client({ host: "localhost", port: PORT, user: DB_USER, password: DB_PASSWORD, database });
  await client.connect();
  try {
    for (const statement of statements) await client.query(statement);
  } finally {
    await client.end();
  }
}

async function ensureDatabase() {
  const client = new pg.Client({ host: "localhost", port: PORT, user: DB_USER, password: DB_PASSWORD, database: "postgres" });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      "select 1 from pg_database where datname = $1",
      [DB_NAME],
    );
    if (rowCount === 0) {
      await client.query(`create database ${DB_NAME}`);
      log(`created database ${DB_NAME}`);
    } else {
      log(`database ${DB_NAME} already exists`);
    }
  } finally {
    await client.end();
  }
}

async function ensureSupabaseRoles() {
  for (const role of SUPABASE_ROLES) {
    await sql([
      `do $$ begin
         if not exists (select 1 from pg_roles where rolname = '${role}') then
           create role ${role} nologin;
         end if;
       end $$`,
    ]);
  }
  log("supabase roles ready");
}

async function applyMigrations() {
  for (const file of MIGRATIONS) {
    const path = join(migrationsDir, file);
    if (!existsSync(path)) {
      log(`skip ${file} (not found)`);
      continue;
    }
    await sql([readFileSync(path, "utf8")], DB_NAME);
    log(`applied ${file}`);
  }
}

async function main() {
  await probe();
  await ensureDatabase();
  await ensureSupabaseRoles();
  await applyMigrations();

  log("");
  log(`DATABASE_URL=postgresql://${DB_USER}:***@localhost:${PORT}/${DB_NAME}`);
  log("ready — API can now connect");
}

main().catch(async (err) => {
  log("fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
