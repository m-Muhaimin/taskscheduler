/**
 * RidgeLine Assistant chat route (ridgeline-assistant-chat.md T4).
 *
 *   POST /api/assistant — one assistant support-chat turn.
 *
 * Auth is OPTIONAL (controller ruling on the T4 brief, superseding the draft
 * contract in ridgeline-assistant-chat.md, which used requireAuth):
 *   - No Authorization header            → anonymous request; still served
 *     (grounded assistant, NO org context).
 *   - Bearer <token> present but invalid → 401 { code: 'invalid_token' } — a
 *     presented-but-bad token is NEVER silently downgraded to anonymous.
 *   - Valid token                        → org context resolved best-effort:
 *     getOrgContextByUserId(userId).catch(() => null); a missing org (or a
 *     DB hiccup) is benign — organizationId is only forwarded into
 *     handleAssistantTurn when non-null.
 *
 * Error envelope uses { code } keys per the controller ruling (differs from
 * the repo-wide { error } dashboard contract — flagged in the T4 report):
 *   400 { code: 'invalid_body', issues: <zod issues> }
 *   401 { code: 'invalid_token' }
 *   500 { code: 'server_error' }
 *
 * The provider is built per-request via createProvider() from
 * @tradescheduler/ai (AI_PROVIDER env, default fallback-only — constructs
 * fine offline, no network).
 */
import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { createProvider } from '@tradescheduler/ai';
import type { AssistantChatRequest, AssistantChatResponse } from '@tradescheduler/shared';
import { JWT_ISSUER, jwtSecret } from '../middleware/auth.js';
import { getOrgContextByUserId } from '../services/organization-service.js';
import { handleAssistantTurn } from '../services/assistant.service.js';

export const assistantRouter = Router();

// ── validation ─────────────────────────────────────────────────────────────

const assistantMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});

const assistantBody = z
  .object({
    messages: z.array(assistantMessageSchema).min(1),
    contextSnippet: z.string().max(2000).optional(),
    tradespersonName: z.string().min(1).max(200).optional(),
    customerPhone: z.string().regex(/^\+?[1-9][0-9]{1,14}$/).optional(),
  })
  .refine((b) => b.messages.length === 0 || b.messages[b.messages.length - 1].role === 'user', {
    message: 'last message must be from the user',
  });

// ── route ──────────────────────────────────────────────────────────────────

assistantRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    // ── Optional auth — no requireAuth; anonymous requests are served. ──
    let userId: string | null = null;
    const header = req.headers.authorization;
    if (header) {
      // Any presented-but-bad token fails closed → 401 invalid_token, never a
      // silent downgrade to anonymous. Verify shape mirrors middleware/auth.ts
      // (same secret source, same issuer check, same sub-claim guard).
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      try {
        const payload = jwt.verify(token, jwtSecret(), { issuer: JWT_ISSUER }) as { sub?: string };
        if (typeof payload.sub !== 'string') {
          res.status(401).json({ code: 'invalid_token' });
          return;
        }
        userId = payload.sub;
      } catch {
        res.status(401).json({ code: 'invalid_token' });
        return;
      }
    }

    const parsed = assistantBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: 'invalid_body', issues: parsed.error.issues });
      return;
    }

    // ── Org context (best-effort, optional) — a missing org is NOT fatal. ──
    let organizationId: string | null = null;
    if (userId != null) {
      const org = await getOrgContextByUserId(userId).catch(() => null);
      organizationId = org?.organizationId ?? null;
    }

    const provider = createProvider();
    const serviceInput: AssistantChatRequest & { organizationId?: string } =
      organizationId != null ? { ...parsed.data, organizationId } : parsed.data;
    const body: AssistantChatResponse = await handleAssistantTurn(serviceInput, provider);
    res.json(body);
  } catch (err) {
    console.error('[assistant] error:', err);
    res.status(500).json({ code: 'server_error' });
  }
});