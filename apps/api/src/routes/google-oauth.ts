/**
 * Google OAuth routes — real connect/disconnect (CP06).
 *
 *   GET    /api/auth/google/start    — JWT-protected: returns { url } (consent URL)
 *   GET    /api/auth/google/callback — public (Google redirects here): exchange
 *                                      code, store tokens, redirect to web settings
 *   GET    /api/auth/google/status   — JWT-protected: { connected, calendarId }
 *   DELETE /api/auth/google          — JWT-protected: disconnect (drop tokens + id)
 *
 * The web app calls /start via authedFetch (the JWT lives in the ts_session
 * cookie and must be attached as an Authorization header — a plain browser
 * navigation would 401), then redirects the browser to the returned URL.
 *
 * Error contract (mirrors auth.ts):
 *   missing/invalid JWT       → 401 (requireAuth middleware)
 *   unconfigured Google env   → 503 'server_not_configured'
 *   bad/expired/used state    → 400 'invalid_state'
 *   missing code              → 400 'invalid_body'
 *   token exchange failure    → 500 'exchange_failed'
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { setUserGoogleCalendarId } from '../services/booking-service.js';
import {
  consumeOauthState,
  createOauthState,
  deleteCredentials,
  exchangeCodeForTokens,
  generateAuthUrl,
  loadCredentials,
  saveCredentials,
} from '../services/google-auth-service.js';
import { requireAuth } from '../middleware/auth.js';

export const googleOauthRouter = Router();

/** Web app origin for the post-consent redirect; overridable in prod. */
function webBaseUrl(): string {
  return process.env.WEB_BASE_URL ?? 'http://localhost:3000';
}

// ── validation ─────────────────────────────────────────────────────────────

const callbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  /** Google's denial reason; presence means the user declined consent. */
  error: z.string().min(1).optional(),
});

// ── error mapping (async routes: wrap with `guarded`) ──────────────────────

function sendOnError(res: Response, err: unknown): boolean {
  if (err instanceof Error && err.message.includes('Google OAuth is not configured')) {
    res.status(503).json({ error: 'server_not_configured' });
    return true;
  }
  if (err instanceof Error && err.message.includes('DATABASE_URL not configured')) {
    res.status(503).json({ error: 'server_not_configured' });
    return true;
  }
  if (err instanceof Error && err.message.includes('Google OAuth exchange')) {
    res.status(500).json({ error: 'exchange_failed' });
    return true;
  }
  console.error('[google-oauth] unexpected error:', err);
  res.status(500).json({ error: 'exchange_failed' });
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

function userIdOf(req: Request): string | null {
  return req.auth?.userId ?? null;
}

// ── routes ─────────────────────────────────────────────────────────────────

googleOauthRouter.get(
  '/start',
  requireAuth,
  guarded(async (req, res) => {
    const userId = userIdOf(req);
    if (!userId) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    const state = await createOauthState(userId);
    res.status(200).json({ url: generateAuthUrl(state) });
  }),
);

googleOauthRouter.get(
  '/callback',
  guarded(async (req, res) => {
    const parsed = callbackQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const { code, state, error } = parsed.data;

    if (error) {
      // User declined at Google's consent screen — no tokens to store.
      res.redirect(`${webBaseUrl()}/dashboard/settings?google=denied`);
      return;
    }
    if (!state) {
      res.status(400).json({ error: 'invalid_state' });
      return;
    }
    const userId = await consumeOauthState(state); // single-use, 10-min TTL
    if (!userId) {
      res.status(400).json({ error: 'invalid_state' });
      return;
    }
    if (!code) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }

    const tokens = await exchangeCodeForTokens(code);
    await saveCredentials(userId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiry: tokens.tokenExpiry,
      scope: tokens.scope,
      calendarId: 'primary',
    });
    await setUserGoogleCalendarId(userId, 'primary');

    res.redirect(`${webBaseUrl()}/dashboard/settings?google=connected`);
  }),
);

googleOauthRouter.get(
  '/status',
  requireAuth,
  guarded(async (req, res) => {
    const userId = userIdOf(req);
    if (!userId) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    const creds = await loadCredentials(userId);
    res.status(200).json({
      connected: creds !== null,
      calendarId: creds?.calendarId ?? null,
    });
  }),
);

googleOauthRouter.delete(
  '/',
  requireAuth,
  guarded(async (req, res) => {
    const userId = userIdOf(req);
    if (!userId) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    await deleteCredentials(userId);
    await setUserGoogleCalendarId(userId, null);
    res.status(200).json({ ok: true });
  }),
);
