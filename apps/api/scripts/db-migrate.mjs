#!/usr/bin/env node
/**
 * Apply all SQL migrations against an arbitrary Postgres (Render, Supabase,
 * local) using DATABASE_URL. Mirrors the migration list + re-apply behavior
 * of local-db.mjs but is connection-agnostic:
 *
 *   DATABASE_URL=postgresql://... node scripts/db-migrate.mjs
 *
 * Safe to re-run: every migration file uses IF NOT EXISTS guards. The app
 * tables are all created idempotently.
 */
import pg from "pg";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const migrationsDir = join(apiRoot, "src", "db", "migrations");

const MIGRATIONS = [
  "001-create-jobs-table.sql",
  "002-create-escalations-table.sql",
  "003-create-conversation-states-table.sql",
  "004-create-tradespeople-table.sql",
  "005-create-ai-usage-table.sql",
  "006-create-organizations-table.sql",
  "007-create-customer-conversation-tables.sql",
  "008-create-appointments-table.sql",
  "009-create-google-oauth-tables.sql",
  "010-customer-verification.sql",
  "011-confirmation-codes.sql",
  "012-assistant-escalation-type.sql",
  "013-staff-phone.sql",
];

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[db-migrate] DATABASE_URL not set — nothing to do.");
  process.exit(0);
}

// ssl is set unconditionally (accepting self-signed/verifying off) because this
// script only runs in deploys/local against Supabase pooler (SSL-required) or
// Render internal Postgres; both are fine with rejectUnauthorized: false.
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  for (const file of MIGRATIONS) {
    const path = join(migrationsDir, file);
    if (!existsSync(path)) {
      console.log(`[db-migrate] skip ${file} (not found)`);
      continue;
    }
    await client.query(readFileSync(path, "utf8"));
    console.log(`[db-migrate] applied ${file}`);
  }
  console.log("[db-migrate] done");
} finally {
  await client.end();
}
