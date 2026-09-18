/**
 * Local development database — real Postgres, no Docker, no admin rights.
 *
 * `embedded-postgres` ships platform-specific Postgres binaries; this script
 * initialises a cluster inside the repo (gitignored) and starts it on 5432.
 *
 *   node scripts/local-db.mjs            # start (stays in foreground)
 *   node scripts/local-db.mjs --reset    # wipe the cluster first
 *
 * On start it also ensures the app database exists and applies the auth
 * migration, so a fresh cluster comes up ready to serve /api/auth.
 *
 * Migrations NOT listed in MIGRATIONS below (the Step-9 escalations and
 * conversation_states DDL) are deliberately skipped — that work is incomplete
 * and its schema is still moving. Add them here once it lands.
 */
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const dataDir = join(apiRoot, ".localdb", "data");

const PORT = Number(process.env.LOCALDB_PORT ?? 5432);
const DB_NAME = "tradescheduler";
const DB_USER = "postgres";
const DB_PASSWORD = "postgres";

/** Auth migration only — see the note above. */
const MIGRATIONS = ["004-create-tradespeople-table.sql"];

/** Supabase defines these roles; creating them keeps the migration verbatim. */
const SUPABASE_ROLES = ["anon", "authenticated"];

const log = (...a) => console.log("[local-db]", ...a);

if (process.argv.includes("--reset") && existsSync(join(apiRoot, ".localdb"))) {
  log("--reset: removing existing cluster");
  rmSync(join(apiRoot, ".localdb"), { recursive: true, force: true });
}

const db = new EmbeddedPostgres({
  databaseDir: dataDir,
  port: PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  authMethod: "scram-sha-256",
  persistent: true,
  onLog: (m) => process.env.LOCALDB_VERBOSE && log(m.trim()),
  onError: (e) => log("error:", e instanceof Error ? e.message : e),
});

/** Connect to the maintenance DB and run a statement list. */
async function sql(statements, database = "postgres") {
  const client = new pg.Client({
    host: "localhost",
    port: PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database,
  });
  await client.connect();
  try {
    for (const statement of statements) await client.query(statement);
  } finally {
    await client.end();
  }
}

async function ensureDatabase() {
  const client = new pg.Client({
    host: "localhost",
    port: PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: "postgres",
  });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      "select 1 from pg_database where datname = $1",
      [DB_NAME],
    );
    if (rowCount === 0) {
      await client.query(`create database ${DB_NAME}`);
      log(`created database ${DB_NAME}`);
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
}

async function applyMigrations() {
  for (const file of MIGRATIONS) {
    const path = join(apiRoot, "src", "db", "migrations", file);
    if (!existsSync(path)) {
      log(`skip ${file} (not found)`);
      continue;
    }
    await sql([readFileSync(path, "utf8")], DB_NAME);
    log(`applied ${file}`);
  }
}

async function main() {
  const fresh = !existsSync(join(dataDir, "PG_VERSION"));
  if (fresh) log(`initialising cluster at ${dataDir}`);
  await db.initialise();
  await db.start();
  log(`postgres ${fresh ? "initialised and " : ""}listening on :${PORT}`);

  await ensureDatabase();
  await ensureSupabaseRoles();
  await applyMigrations();

  log("");
  log(`DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:${PORT}/${DB_NAME}`);
  log("ready — press Ctrl+C to stop");
}

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  log("stopping...");
  try {
    await db.stop();
  } catch (e) {
    log("stop failed:", e instanceof Error ? e.message : e);
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch(async (err) => {
  log("fatal:", err instanceof Error ? err.message : err);
  await shutdown();
});
