# T11 — automation toggle persistence (API + web)

## Why
Settings "Automation" toggles (ai-front-desk, review-requests, deposit-required)
are pure client-local useState — nothing persists. Fix: per-org settings storage
(rl_organizations.settings jsonb, added by the same RL_010 DDL as T9) + GET/PATCH.

## API (wired)
1. packages/shared/src/types.ts — add:
   `export interface AutomationSettings { aiFrontDesk: boolean; reviewRequests: boolean; depositRequired: boolean; }`
   + `export interface DashboardAutomationResponse { automation: AutomationSettings; }`
2. routes/dashboard/settings.ts (mount in routes/dashboard/index.ts):
   - `GET /api/dashboard/settings/automation` — requireAuth + orgContext (403
     `no_organization`); read org.settings jsonb; return merged DEFAULTS
     `{aiFrontDesk:true, reviewRequests:true, depositRequired:false}` over stored
     values (unknown/missing keys → default; 200 `{automation}`).
   - `PATCH /api/dashboard/settings/automation` body `{automation: partial}`
     — validate: object, only the 3 known keys, all boolean (else 400 `invalid_body`);
     merge into org.settings jsonb PRESERVING any other keys already in settings
     (jsonb_set / || merge at the automation key); return full 200 `{automation}`.
3. organization-service.ts: `getOrganizationSettings(orgId)` +
   `updateOrganizationSettings(orgId, patch)` (or settings-service.ts if cleaner —
   keep org-scoped UPDATE … WHERE id).
4. Tests: GET defaults when empty, GET merged stored, PATCH partial merge + other-key
   preservation, PATCH bad-key/bad-type 400, 403, 401.

## Web (forge)
apps/web/components/dashboard/settings-panel.tsx + toggle-list.tsx + lib/dashboard-api.ts:
- toggle-list.tsx: add CONTROLLED mode — optional `values?: Record<string, boolean>`
  prop; when provided, Switch `on` reads from values (ignore defaultOn) and
  onToggle is the ONLY writer (no internal setState); fully backwards-compatible
  (landing page "Your rules" keeps uncontrolled defaultOn path).
- lib/dashboard-api.ts: `getAutomationSettings()` + `updateAutomationSettings(patch)`.
- settings-panel.tsx: replace the static ROWS defaultOns — load automation on mount
  
- Toggling → PATCH via updateAutomationSettings (optimistic: flip → on failure revert
  + error toast; on success success toast). Loading-failed → show defaults + toast.
- Keep all existing OAuth / profile / password sections untouched.

## Acceptance
- API: typecheck + suite green; live: PATCH then GET on throwaway org returns merged
  values; second PATCH preserves other keys; 400 path live.
- Web: build green, tests 11/11, dev walk: toggles load from GET, flip persists
  (reload → same state), network tab shows PATCH.
- Do NOT commit. Report: docs/tasks/v2/reports/T11-automation-settings.md (API + web verification).
