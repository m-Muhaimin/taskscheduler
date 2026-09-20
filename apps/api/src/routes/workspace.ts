/**
 * Workspace setup routes — the bridge between "has an account" and "has an
 * organization". Every /api/dashboard/* route already 403s with
 * 'no_organization' for a user with no membership row (see
 * organization-service.ts getOrgContextByUserId), and the signup form has
 * always collected a business name but — per the T4 brief's explicit ruling
 * ("keep business field in UI, do NOT send to API") — deliberately dropped
 * it before it reached the API, since no org-creation path existed yet.
 * These two routes are that path.
 *
 *   GET  /api/workspace/status — { hasOrganization: boolean }. Cheap check
 *        the web app uses right after signup/login to decide whether to
 *        route to /onboarding/workspace or straight to /dashboard.
 *   POST /api/workspace        — { name, timezone? } -> 201 { organization }.
 *        Creates the organization + an OWNER membership row for the caller,
 *        as one transaction (organization-service.ts createOrganization).
 *        409 'already_has_organization' if the caller is already a member
 *        of one — this is a one-time setup step, not an "add another
 *        workspace" endpoint (that's a different, not-yet-built feature).
 */
import { Router } from 'express';
import { z } from 'zod';
import type { CreateWorkspaceResponse, DashboardApiErrorResponse, WorkspaceStatusResponse } from '@tradescheduler/shared';
import { requireAuth } from '../middleware/auth.js';
import { createOrganization, getOrgContextByUserId } from '../services/organization-service.js';

export const workspaceRouter = Router();

const createWorkspaceBody = z.object({
  name: z.string().trim().min(1).max(120),
  // IANA name, loosely validated (Intl.DateTimeFormat throws on a truly bad
  // one at read time elsewhere) — not worth a hardcoded zone list here.
  timezone: z.string().trim().min(1).max(64).optional(),
});

const DEFAULT_TIMEZONE = 'America/New_York';

workspaceRouter.get('/status', requireAuth, async (req, res) => {
  try {
    const ctx = await getOrgContextByUserId(req.auth!.userId);
    res.status(200).json({ hasOrganization: ctx !== null } satisfies WorkspaceStatusResponse);
  } catch (err) {
    console.error('[workspace] status error:', err);
    res.status(500).json({ error: 'server_error' } satisfies DashboardApiErrorResponse);
  }
});

workspaceRouter.post('/', requireAuth, async (req, res) => {
  try {
    const parsed = createWorkspaceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' } satisfies DashboardApiErrorResponse);
      return;
    }

    // Belt-and-suspenders: rl_organization_members has no unique(user_id)
    // constraint (a user could theoretically join more than one org via a
    // future invite feature — T16's own investigation notes this), so this
    // is an app-level check, not a DB constraint. A race between two
    // concurrent first-setup requests from the same brand-new user isn't
    // realistically reachable from the UI and isn't worth a transaction-
    // level guard here.
    const existing = await getOrgContextByUserId(req.auth!.userId);
    if (existing) {
      res.status(409).json({ error: 'already_has_organization' } satisfies DashboardApiErrorResponse);
      return;
    }

    const organization = await createOrganization({
      name: parsed.data.name,
      timezone: parsed.data.timezone || DEFAULT_TIMEZONE,
      ownerId: req.auth!.userId,
    });

    res.status(201).json({
      organization: { id: organization.id, name: organization.name, slug: organization.slug, timezone: organization.timezone },
    } satisfies CreateWorkspaceResponse);
  } catch (err) {
    console.error('[workspace] create error:', err);
    res.status(500).json({ error: 'server_error' } satisfies DashboardApiErrorResponse);
  }
});
