import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { EscalationListResponse } from '@tradescheduler/shared';

const router = Router();

// ── JWT auth (inline — no shared middleware module yet) ──────────────────
const JWT_SECRET = process.env.JWT_SECRET ?? '';
const JWT_ISSUER = process.env.JWT_ISSUER ?? 'tradescheduler';

function authorize(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    _res.status(401).json({ error: 'missing_token' });
    return;
  }
  const token = header.slice(7);
  if (!JWT_SECRET) {
    _res.status(500).json({ error: 'server_not_configured' });
    return;
  }
  try {
    jwt.verify(token, JWT_SECRET, { issuer: JWT_ISSUER });
    next();
  } catch {
    _res.status(401).json({ error: 'invalid_token' });
  }
}

// ── In-memory escalation store (stand-in for a real data layer) ──────────
// Replace with a Postgres/Supabase query when the data layer lands.
type StoredEscalation = {
  id: string;
  type: string;
  customerPhone: string;
  content: string | null;
  status: 'pending' | 'resolved';
  createdAt: string;
  resolvedAt: string | null;
};

const escalations: StoredEscalation[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    type: 'ambiguous_intent',
    customerPhone: '+155****4567',
    content: 'Customer reply "maybe" — intent confidence 0.42, below 0.7 threshold.',
    status: 'pending',
    createdAt: '2026-09-18T10:15:00.000Z',
    resolvedAt: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    type: 'no_availability',
    customerPhone: '+155****5678',
    content: 'No open slots in the next 14 days after the customer rejected all three offered times.',
    status: 'pending',
    createdAt: '2026-09-17T14:42:00.000Z',
    resolvedAt: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    type: 'calendar_api_failure',
    customerPhone: '+155****7890',
    content: 'Google Calendar API returned 503 when querying availability for +155****7890.',
    status: 'resolved',
    createdAt: '2026-09-16T09:00:00.000Z',
    resolvedAt: '2026-09-16T09:05:00.000Z',
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  ambiguous_intent: 'Ambiguous intent',
  no_availability: 'No availability',
  calendar_api_failure: 'Calendar API failure',
  sms_delivery_failure: 'SMS delivery failure',
  processing_error: 'Processing error',
};

function paginate(items: StoredEscalation[], page: number, pageSize: number): StoredEscalation[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

function toResponse(items: StoredEscalation[], page: number, pageSize: number): EscalationListResponse {
  return {
    escalations: items.map((e) => ({
      id: e.id,
      type: e.type as import('@tradescheduler/shared').EscalationType,
      customerPhone: e.customerPhone,
      content: e.content,
      status: e.status as import('@tradescheduler/shared').EscalationStatus,
      createdAt: e.createdAt,
      resolvedAt: e.resolvedAt,
    })),
    total: escalations.length,
    page,
    pageSize,
  };
}

// ── GET /api/dashboard/escalations ────────────────────────────────────────

router.get('/', authorize, (req, res) => {
  const page = Math.max(1, Number((req.query.page as string) ?? '1'));
  const pageSize = Math.max(1, Math.min(100, Number((req.query.pageSize as string) ?? '20')));

  const pending = escalations.filter((e) => e.status === 'pending');
  const filtered = pending.slice();

  const pageItems = paginate(filtered, page, pageSize);
  const response = toResponse(pageItems, page, pageSize);

  res.json(response);
});

export const escalationsRouter = router;
