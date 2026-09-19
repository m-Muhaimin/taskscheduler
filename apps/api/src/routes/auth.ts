/**
 * Dashboard auth routes (PRD: "JWT auth for tradesperson dashboard").
 *
 *   POST /api/auth/register  — create a tradesperson account → 201 { token, user }
 *   POST /api/auth/login     — email/password → 200 { token, user }
 *   GET  /api/auth/me        — verify token → 200 { user }
 *
 * Auth model:
 *   - scrypt password hashing (auth-service.ts; node:crypto, no new deps)
 *   - JWT signed with `sub` = tradesperson id, issuer `tradescheduler`,
 *     7-day expiry. Web stores the token in the `ts_session` cookie.
 *   - Error contract (matches middleware/auth.ts):
 *       invalid body → 400 'invalid_body'
 *       unknown email / wrong password → 401 'invalid_credentials' (deliberately
 *         identical — no account-enumeration oracle)
 *       email already registered → 409 'email_taken'
 *       JWT_SECRET missing → 500 'server_not_configured'
 *       DB unreachable → 503 'server_not_configured'
 */
import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { AuthUser } from '@tradescheduler/shared';
import {
  createTradesperson,
  findTradespersonByEmail,
  findTradespersonById,
  hashPassword,
  toAuthUser,
  updateTradespersonPassword,
  updateTradespersonProfile,
  verifyPassword,
} from '../services/auth-service.js';
import { JWT_ISSUER, jwtSecret, requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

// ── validation ─────────────────────────────────────────────────────────────

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());

const registerBody = z.object({
  displayName: z.string().trim().min(1).max(80),
  email: emailSchema,
  password: z.string().min(8).max(200),
});

const loginBody = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

// PATCH /api/auth/profile — partial profile update; at least one field required.
// phoneNumber: E.164-ish (matches the rl_tradespeople phone_number check);
// null or '' clears the stored value.
const phoneNumberSchema = z
  .union([z.string().trim().regex(/^\+?[1-9][0-9]{1,14}$/), z.literal(''), z.null()])
  .transform((v) => (v === '' ? null : v));

const profilePatchBody = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  email: emailSchema.optional(),
  phoneNumber: phoneNumberSchema.optional(),
});

const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  // MIN_PASSWORD_LENGTH in the web (apps/web/lib/validation.ts) is 8; the UI
  // validates first, the server enforces the same bound.
  newPassword: z.string().min(8).max(200),
});

// ── token signing ──────────────────────────────────────────────────────────

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, email: user.email }, jwtSecret(), {
    issuer: JWT_ISSUER,
    expiresIn: TOKEN_TTL_SECONDS,
  });
}

function authResponse(user: AuthUser): { token: string; user: AuthUser } {
  return { token: signToken(user), user };
}

// ── error mapping (async routes: wrap with `sendOnError`) ──────────────────

/** Normalizes service failures into clean 5xx JSON. Returns false if handled. */
function sendOnError(res: Response, err: unknown): boolean {
  if (err instanceof Error && err.message === 'JWT_SECRET not configured') {
    res.status(500).json({ error: 'server_not_configured' });
    return true;
  }
  if (err instanceof Error && err.message.includes('DATABASE_URL not configured')) {
    res.status(503).json({ error: 'server_not_configured' });
    return true;
  }
  if (err instanceof Error && err.message.includes('duplicate key')) {
    res.status(409).json({ error: 'email_taken' });
    return true;
  }
  console.error('[auth] unexpected error:', err);
  res.status(500).json({ error: 'server_not_configured' });
  return true;
}

function guarded(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      sendOnError(res, err);
    }
  };
}

// ── routes ─────────────────────────────────────────────────────────────────

authRouter.post(
  '/register',
  guarded(async (req, res) => {
    const parsed = registerBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const { displayName, email, password } = parsed.data;

    // Cheap duplicate check before hashing (costly); the unique index is the
    // real guard — a race between two registers still hits the 409 path.
    const existing = await findTradespersonByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'email_taken' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const row = await createTradesperson({ email, displayName, passwordHash });
    res.status(201).json(authResponse(toAuthUser(row)));
  }),
);

authRouter.post(
  '/login',
  guarded(async (req, res) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const { email, password } = parsed.data;

    const row = await findTradespersonByEmail(email);
    const ok = row !== null && (await verifyPassword(password, row.password_hash));
    if (!ok) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }

    res.status(200).json(authResponse(toAuthUser(row)));
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  guarded(async (req, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    const row = await findTradespersonById(userId);
    if (!row) {
      res.status(404).json({ error: 'invalid_token' }); // token for deleted account
      return;
    }
    res.status(200).json({ user: toAuthUser(row) });
  }),
);

authRouter.patch(
  '/profile',
  requireAuth,
  guarded(async (req, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    const parsed = profilePatchBody.safeParse(req.body);
    const fields = parsed.success ? parsed.data : {};
    if (!parsed.success || Object.keys(fields).length === 0) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    // Email uniqueness: 409 when ANOTHER tradesperson holds it; a no-op
    // update against the caller's own email succeeds.
    if (fields.email !== undefined && fields.email !== null) {
      const holder = await findTradespersonByEmail(fields.email);
      if (holder && holder.id !== userId) {
        res.status(409).json({ error: 'email_taken' });
        return;
      }
    }
    const row = await updateTradespersonProfile(userId, fields);
    res.status(200).json({ user: toAuthUser(row) });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  guarded(async (req, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    const parsed = changePasswordBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const { currentPassword, newPassword } = parsed.data;
    const row = await findTradespersonById(userId);
    if (!row) {
      res.status(404).json({ error: 'invalid_token' }); // token for deleted account
      return;
    }
    // Same verify as login — constant-time, same error body (no oracle).
    const ok = await verifyPassword(currentPassword, row.password_hash);
    if (!ok) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }
    const passwordHash = await hashPassword(newPassword);
    await updateTradespersonPassword(userId, passwordHash);
    res.status(200).json({ ok: true });
  }),
);
