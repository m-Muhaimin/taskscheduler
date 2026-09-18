/**
 * Shared JWT verification middleware (build-sequence.md "middleware/auth.ts").
 *
 * Exact parity with the inline `authorize` guard that was living in
 * routes/dashboard/escalations.ts (same env names, issuer, error bodies) —
 * extracted so auth routes and future dashboard routes share one gate.
 *
 * Semantics:
 *   - Bearer token in `Authorization` header (spec §1.8.1 / build-sequence).
 *   - Missing header            → 401 { error: 'missing_token' }
 *   - Unverifiable/expired token → 401 { error: 'invalid_token' }
 *   - No JWT_SECRET configured   → 500 { error: 'server_not_configured' }
 *
 * On success sets `req.auth = { userId }` (decoded `sub` claim).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';

export const JWT_ISSUER = process.env.JWT_ISSUER ?? 'tradescheduler';

export function jwtSecret(): string {
  return process.env.JWT_SECRET ?? '';
}

/** Decoded `sub` on the request after a successful requireAuth pass. */
export type AuthContext = { userId: string };

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing_token' });
    return;
  }
  const token = header.slice(7);
  const secret = jwtSecret();
  if (!secret) {
    res.status(500).json({ error: 'server_not_configured' });
    return;
  }
  try {
    const payload = jwt.verify(token, secret, { issuer: JWT_ISSUER }) as { sub?: string };
    if (typeof payload.sub !== 'string') {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    req.auth = { userId: payload.sub };
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}

/** Express Router is re-exported only for type-import convenience in tests. */
export type { Router };
