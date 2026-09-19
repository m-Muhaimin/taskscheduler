/**
 * Auth service (dashboard JWT — PRD).
 *
 * Responsibilities:
 *  - Password hashing/verification via node:crypto scrypt (no new deps, no
 *    native build; OWASP-recommended KDF). Stored format is self-describing:
 *        scrypt$N$r$p$saltB64$hashB64
 *    so cost params can be raised in the future without breaking old hashes.
 *  - Tradesperson identity rows: find by email, create. Same env-free lazy
 *    pool pattern as queue-service.ts / escalation-service.ts (boots cleanly
 *    with no .env; DATABASE_URL required only when a query actually runs).
 *
 * JWT signing/verification lives in routes/auth.ts + middleware/auth.ts —
 * this module never touches tokens.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { Pool } from 'pg';
import type { AuthUser } from '@tradescheduler/shared';

/** Typed promisified scrypt (promisify() loses the ScryptOptions overload). */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

// ── password hashing ───────────────────────────────────────────────────────

// N=2^14,r=8,p=1 → ~16 MiB memory, under OpenSSL's default 32 MiB scrypt
// maxmem (N=2^15 with r=8 exceeds it and throws ERR_CRYPTO_INVALID_SCRYPT_PARAMS).
// Parameters are stored in each hash, so they can be raised later without
// breaking existing verifications.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

/** Hash a plaintext password → `scrypt$N$r$p$saltB64$hashB64`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = (await scrypt(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }));
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

/** Constant-time password check against a stored `scrypt$…` string. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = (await scrypt(password, salt, expected.length, {
      N: n,
      r,
      p,
    }));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ── identity rows (lazy pg pool) ───────────────────────────────────────────

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

/** Table override env matches the escalation-service convention. */
export function tradespeopleTable(): string {
  return process.env.TRADESPEOPLE_TABLE ?? 'rl_tradespeople';
}

export type TradespersonRow = {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  phone_number: string | null;
  created_at: Date;
};

function toAuthUser(row: TradespersonRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    phoneNumber: row.phone_number,
  };
}

export async function findTradespersonByEmail(
  email: string,
): Promise<TradespersonRow | null> {
  const tableName = tradespeopleTable();
  const { rows } = await getPool().query<TradespersonRow>(
    `select id, email, password_hash, display_name, phone_number, created_at
     from ${tableName}
     where email = $1
     limit 1`,
    [email.toLowerCase()],
  );
  return rows[0] ?? null;
}

export async function createTradesperson(input: {
  email: string;
  displayName: string;
  passwordHash: string;
}): Promise<TradespersonRow> {
  const tableName = tradespeopleTable();
  const { rows } = await getPool().query<TradespersonRow>(
    `insert into ${tableName} (email, password_hash, display_name)
     values ($1, $2, $3)
     returning id, email, password_hash, display_name, phone_number, created_at`,
    [input.email.toLowerCase(), input.passwordHash, input.displayName],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('createTradesperson: insert returned no row');
  }
  return row;
}

export { toAuthUser };

export async function findTradespersonById(
  id: string,
): Promise<TradespersonRow | null> {
  const tableName = tradespeopleTable();
  const { rows } = await getPool().query<TradespersonRow>(
    `select id, email, password_hash, display_name, phone_number, created_at
     from ${tableName}
     where id = $1
     limit 1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Update ONLY the provided profile columns, all-or-nothing in one statement,
 * then return the fresh row. Caller (route) pre-checks email uniqueness.
 */
export async function updateTradespersonProfile(
  id: string,
  fields: {
    displayName?: string;
    email?: string;
    phoneNumber?: string | null;
  },
): Promise<TradespersonRow> {
  const tableName = tradespeopleTable();
  const sets: string[] = [];
  const params: (string | null)[] = [];
  if (fields.displayName !== undefined) {
    sets.push(`display_name = $${sets.length + 1}`);
    params.push(fields.displayName);
  }
  if (fields.email !== undefined) {
    sets.push(`email = $${sets.length + 1}`);
    params.push(fields.email.toLowerCase());
  }
  if (fields.phoneNumber !== undefined) {
    sets.push(`phone_number = $${sets.length + 1}`);
    params.push(fields.phoneNumber);
  }
  if (sets.length === 0) {
    throw new Error('updateTradespersonProfile: no fields provided');
  }
  const { rows } = await getPool().query<TradespersonRow>(
    `update ${tableName}
     set ${sets.join(', ')}
     where id = $${sets.length + 1}
     returning id, email, password_hash, display_name, phone_number, created_at`,
    [...params, id],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('updateTradespersonProfile: no row matched');
  }
  return row;
}

/** Replace the credential hash (verified current password by the route). */
export async function updateTradespersonPassword(
  id: string,
  passwordHash: string,
): Promise<void> {
  const tableName = tradespeopleTable();
  await getPool().query(
    `update ${tableName}
     set password_hash = $1
     where id = $2`,
    [passwordHash, id],
  );
}
