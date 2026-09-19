/**
 * Google OAuth service — real connect/disconnect wiring (CP06).
 *
 * Replaces the interim per-user env-var refresh token (GOOGLE_REFRESH_TOKEN_<userId>)
 * with the standard auth-code flow + a per-tradesperson credential store
 * (rl_google_credentials, migration 009):
 *
 *   generateAuthUrl       — consent URL for the Settings "Connect" button
 *   exchangeCodeForTokens — POST to Google with the auth code (offline+consent)
 *   save/load/deleteCredentials — rl_google_credentials CRUD
 *   create/consumeOauthState   — one-time state for the callback
 *
 * Env-free boot: Google credentials + DATABASE_URL read on first use, never at
 * module scope. Table overrides: GOOGLE_CREDENTIALS_TABLE, GOOGLE_OAUTH_STATES_TABLE.
 * Tests mock 'pg' and swap env vars (same pattern as auth-service / booking-service).
 */

import { randomBytes } from 'node:crypto';
import { google } from 'googleapis';
import { Pool } from 'pg';
import type { GoogleCredentials } from '@tradescheduler/shared';

/** Full read/write calendar scope: needed for both freebusy queries and event
 *  creation in the scheduling pipeline. */
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

// ---------------------------------------------------------------------------
// Lazy pool + table names
// ---------------------------------------------------------------------------

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL not configured');
    }
    pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

function credentialsTable(): string {
  return process.env.GOOGLE_CREDENTIALS_TABLE ?? 'rl_google_credentials';
}

function oauthStatesTable(): string {
  return process.env.GOOGLE_OAUTH_STATES_TABLE ?? 'rl_oauth_states';
}

// ---------------------------------------------------------------------------
// OAuth client + consent URL + token exchange (real Google calls)
// ---------------------------------------------------------------------------

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

/** OAuth app credentials from env; throws when unconfigured (checked per call,
 *  never at module scope — matches the calendar service's env-free-boot rule). */
export function googleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Google OAuth is not configured (need GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function buildOAuth2Client(): InstanceType<typeof google.auth.OAuth2> {
  const { clientId, clientSecret, redirectUri } = googleOAuthConfig();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** Google consent URL for the Settings "Connect" button (state = one-time nonce). */
export function generateAuthUrl(state: string): string {
  return buildOAuth2Client().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_CALENDAR_SCOPE,
    state,
  });
}

export type ExchangeResult = {
  accessToken: string;
  refreshToken: string;
  /** ISO 8601; null when Google omitted expires_in. */
  tokenExpiry: string | null;
  scope: string | null;
};

/** Exchanges the callback `code` for tokens. Hits Google — not unit-tested;
 *  route tests mock this function. */
export async function exchangeCodeForTokens(code: string): Promise<ExchangeResult> {
  const oauth2Client = buildOAuth2Client();
  const { tokens } = await oauth2Client.getToken({ code });
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Google OAuth exchange returned no tokens (offline access not granted?)');
  }
  // google-auth-library computes expiry_date (ms epoch) from the API's
  // expires_in field inside getToken() before resolving.
  const tokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null;
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiry,
    scope: tokens.scope ?? null,
  };
}

// ---------------------------------------------------------------------------
// Credential store (rl_google_credentials)
// ---------------------------------------------------------------------------

export type SaveCredentialsInput = {
  accessToken: string;
  refreshToken: string;
  tokenExpiry: string | null;
  scope: string | null;
  calendarId: string | null;
};

/** Upserts the tradesperson's Google tokens (connect/refresh bookkeeping). */
export async function saveCredentials(
  userId: string,
  creds: SaveCredentialsInput,
): Promise<void> {
  const tableName = credentialsTable();
  await getPool().query(
    `insert into public.${tableName}
       (user_id, access_token, refresh_token, token_expiry, scope, calendar_id, updated_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (user_id) do update set
       access_token   = excluded.access_token,
       refresh_token  = excluded.refresh_token,
       token_expiry   = excluded.token_expiry,
       scope          = excluded.scope,
       calendar_id    = excluded.calendar_id,
       updated_at     = now()`,
    [userId, creds.accessToken, creds.refreshToken, creds.tokenExpiry, creds.scope, creds.calendarId],
  );
}

type CredentialsRow = {
  user_id: string;
  access_token: string;
  refresh_token: string;
  token_expiry: Date | null;
  scope: string | null;
  calendar_id: string | null;
};

/** The stored tokens for a tradesperson, or null when never connected. */
export async function loadCredentials(userId: string): Promise<GoogleCredentials | null> {
  const tableName = credentialsTable();
  const { rows } = await getPool().query<CredentialsRow>(
    `select user_id, access_token, refresh_token, token_expiry, scope, calendar_id
       from public.${tableName}
      where user_id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenExpiry: row.token_expiry ? new Date(row.token_expiry).toISOString() : null,
    scope: row.scope,
    calendarId: row.calendar_id,
  };
}

/** Removes the stored tokens (Settings "Disconnect"). */
export async function deleteCredentials(userId: string): Promise<void> {
  const tableName = credentialsTable();
  await getPool().query(`delete from public.${tableName} where user_id = $1`, [userId]);
}

// ---------------------------------------------------------------------------
// One-time consent state (rl_oauth_states, 10-minute TTL)
// ---------------------------------------------------------------------------

/** Creates a fresh state nonce for this user; returns the value to embed in
 *  the consent URL. */
export async function createOauthState(userId: string): Promise<string> {
  const tableName = oauthStatesTable();
  const state = randomBytes(24).toString('hex');
  await getPool().query(
    `insert into public.${tableName} (state, user_id, created_at, expires_at)
     values ($1, $2, now(), now() + interval '10 minutes')`,
    [state, userId],
  );
  return state;
}

/** Single-use consume: atomically deletes the row and returns its owner, or
 *  null when unknown/expired/already used. */
export async function consumeOauthState(state: string): Promise<string | null> {
  const tableName = oauthStatesTable();
  const { rows } = await getPool().query<{ user_id: string }>(
    `delete from public.${tableName}
      where state = $1 and expires_at > now()
     returning user_id`,
    [state],
  );
  return rows[0]?.user_id ?? null;
}
