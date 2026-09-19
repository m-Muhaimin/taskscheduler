import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { getOrgContextByUserId } from '../../services/organization-service.js';
import { getOrgNow, getWeekSchedule } from '../../services/dashboard-service.js';
import type { DashboardApiErrorResponse } from '@tradescheduler/shared';

/**
 * GET /api/dashboard/schedule?weekStart=YYYY-MM-DD&weekEnd=YYYY-MM-DD
 * Defaults to the current org-tz week (Monday..Sunday); both params optional
 * but must be ISO dates with weekStart < weekEnd and range <= 8 weeks.
 * requireAuth guarantees req.auth before this handler runs.
 */
const router = Router();

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) => {
      // Reject non-calendar dates (e.g. 2026-02-30) that V8 leniently
      // normalizes — Postgres would 500 on them via `AT TIME ZONE` casts.
      const t = Date.parse(`${s}T00:00:00Z`);
      return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
    },
    { message: 'not a calendar date' },
  );

const querySchema = z.object({
  weekStart: isoDate.optional(),
  weekEnd: isoDate.optional(),
});

const MAX_WEEK_RANGE_DAYS = 8 * 7; // 8 weeks (brief)

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_query' } satisfies DashboardApiErrorResponse);
      return;
    }
    const ctx = await getOrgContextByUserId(req.auth!.userId);
    if (!ctx) {
      res.status(403).json({ error: 'no_organization' } satisfies DashboardApiErrorResponse);
      return;
    }

    let weekStart = parsed.data.weekStart;
    let weekEnd = parsed.data.weekEnd;
    if (!weekStart || !weekEnd) {
      const now = await getOrgNow(ctx.timezone);
      weekStart = now.monday;
      weekEnd = addDays(now.monday, 7);
    }
    if (
      Number.isNaN(Date.parse(`${weekStart}T00:00:00Z`)) ||
      Number.isNaN(Date.parse(`${weekEnd}T00:00:00Z`)) ||
      !(daysBetween(weekStart, weekEnd) > 0) ||
      daysBetween(weekStart, weekEnd) > MAX_WEEK_RANGE_DAYS
    ) {
      res.status(400).json({ error: 'invalid_query' } satisfies DashboardApiErrorResponse);
      return;
    }

    const schedule = await getWeekSchedule(ctx.organizationId, ctx.timezone, weekStart, weekEnd);
    res.json(schedule);
  } catch (err) {
    console.error('[dashboard] schedule error:', err);
    res.status(500).json({ error: 'server_error' } satisfies DashboardApiErrorResponse);
  }
});

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

export const scheduleRouter = router;