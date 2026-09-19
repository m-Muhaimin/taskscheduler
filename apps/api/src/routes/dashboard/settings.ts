import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import {
  getOrgContextByUserId,
  getOrganizationSettings,
  updateOrganizationSettings,
} from '../../services/organization-service.js';
import type {
  AutomationSettings,
  DashboardAutomationResponse,
  DashboardApiErrorResponse,
} from '@tradescheduler/shared';

/**
 * Automation settings routes (T11):
 *  - GET   /api/dashboard/settings/automation — org settings jsonb,
 *    automation values merged over DEFAULTS (unknown/missing/non-boolean
 *    stored values fall back to the default); 200 {automation}.
 *  - PATCH /api/dashboard/settings/automation — body {automation: partial}
 *    (object, only the 3 known keys, all boolean → else 400 invalid_body);
 *    merged into settings.automation via updateOrganizationSettings, which
 *    preserves every other key in the org settings jsonb; 200 {automation}.
 */
const router = Router();

/** Defaults applied over stored automation values. */
const AUTOMATION_DEFAULTS: AutomationSettings = {
  aiFrontDesk: true,
  reviewRequests: true,
  depositRequired: false,
};

const AUTOMATION_KEYS: ReadonlySet<string> = new Set(['aiFrontDesk', 'reviewRequests', 'depositRequired']);

/** Stored `automation` record from a settings jsonb blob ({} when absent). */
function storedAutomation(settings: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const automation = settings?.automation;
  return automation && typeof automation === 'object' && !Array.isArray(automation)
    ? (automation as Record<string, unknown>)
    : {};
}

/** Merge stored automation over DEFAULTS — stored wins only when boolean. */
function mergedAutomation(settings: Record<string, unknown> | null | undefined): AutomationSettings {
  const stored = storedAutomation(settings);
  return {
    aiFrontDesk: typeof stored.aiFrontDesk === 'boolean' ? stored.aiFrontDesk : AUTOMATION_DEFAULTS.aiFrontDesk,
    reviewRequests: typeof stored.reviewRequests === 'boolean' ? stored.reviewRequests : AUTOMATION_DEFAULTS.reviewRequests,
    depositRequired: typeof stored.depositRequired === 'boolean' ? stored.depositRequired : AUTOMATION_DEFAULTS.depositRequired,
  };
}

/** PATCH body automation: plain object with only known keys, all boolean. */
function parseAutomationPatch(req: Request): Record<string, boolean> | null {
  const automation = (req.body as { automation?: unknown } | undefined)?.automation;
  if (!automation || typeof automation !== 'object' || Array.isArray(automation)) return null;
  const rec = automation as Record<string, unknown>;
  const keys = Object.keys(rec);
  if (keys.some((k) => !AUTOMATION_KEYS.has(k))) return null;
  if (keys.some((k) => typeof rec[k] !== 'boolean')) return null;
  return rec as Record<string, boolean>;
}

async function resolveOrg(req: Request, res: Response): Promise<{ organizationId: string } | null> {
  const ctx = await getOrgContextByUserId(req.auth!.userId);
  if (!ctx) {
    res.status(403).json({ error: 'no_organization' } satisfies DashboardApiErrorResponse);
    return null;
  }
  return { organizationId: ctx.organizationId };
}

router.get('/automation', requireAuth, async (req, res) => {
  try {
    const org = await resolveOrg(req, res);
    if (!org) return;
    const settings = await getOrganizationSettings(org.organizationId);
    const body: DashboardAutomationResponse = { automation: mergedAutomation(settings) };
    res.json(body);
  } catch (err) {
    console.error('[dashboard] settings error:', err);
    res.status(500).json({ error: 'server_error' } satisfies DashboardApiErrorResponse);
  }
});

router.patch('/automation', requireAuth, async (req, res) => {
  try {
    const org = await resolveOrg(req, res);
    if (!org) return;

    const patch = parseAutomationPatch(req);
    if (patch === null) {
      res.status(400).json({ error: 'invalid_body' } satisfies DashboardApiErrorResponse);
      return;
    }

    const updated = await updateOrganizationSettings(org.organizationId, patch);
    const body: DashboardAutomationResponse = { automation: mergedAutomation(updated) };
    res.json(body);
  } catch (err) {
    console.error('[dashboard] settings error:', err);
    res.status(500).json({ error: 'server_error' } satisfies DashboardApiErrorResponse);
  }
});

export const settingsRouter = router;