import { authedFetch, clearSessionCookie } from "@/lib/auth";
import type { CreateWorkspaceResponse, DashboardApiErrorResponse, WorkspaceStatusResponse } from "@tradescheduler/shared";

/**
 * Workspace setup — the bridge between "has an account" and "has an
 * organization" (see apps/api/src/routes/workspace.ts). Deliberately
 * separate from dashboard-api.ts: those calls all assume an org already
 * exists (they 403 with NO_ORGANIZATION otherwise); these two are the ones
 * that resolve that gap in the first place, so they can't share the same
 * NO_ORGANIZATION-means-redirect-to-onboarding assumption.
 */

export class WorkspaceApiError extends Error {
  readonly status: number;
  readonly code?: DashboardApiErrorResponse["error"];

  constructor(status: number, message: string, code?: DashboardApiErrorResponse["error"]) {
    super(message);
    this.name = "WorkspaceApiError";
    this.status = status;
    this.code = code;
  }
}

/** Sentinel: 401 — a redirect to /login is already in flight. */
export const WORKSPACE_SESSION_EXPIRED = Symbol("workspace_session_expired");

/**
 * Resolves where to send someone right after signIn()/signUp() succeeds:
 * `/dashboard` if they already belong to an organization, otherwise
 * `/onboarding/workspace`. Returns null when a 401 fired mid-check and a
 * redirect to /login is already in flight — callers should just return
 * without pushing anywhere in that case (mirrors the SESSION_EXPIRED
 * convention in dashboard-api.ts).
 */
export async function resolvePostAuthPath(): Promise<string | null> {
  const status = await getWorkspaceStatus();
  if (status === WORKSPACE_SESSION_EXPIRED) return null;
  return status.hasOrganization ? "/dashboard" : "/onboarding/workspace";
}

/**
 * GET /api/workspace/status. Used right after signup/login to decide whether
 * to route to /onboarding/workspace or straight to /dashboard, and inside
 * the onboarding page itself to bounce someone who already has a workspace
 * (e.g. they hit back/forward, or opened an old bookmark) back to /dashboard.
 */
export async function getWorkspaceStatus(): Promise<WorkspaceStatusResponse | typeof WORKSPACE_SESSION_EXPIRED> {
  let res: Response;
  try {
    res = await authedFetch("/api/workspace/status", { cache: "no-store" });
  } catch {
    throw new WorkspaceApiError(0, "Couldn't reach the server. Check your connection and try again.");
  }

  if (res.status === 401) {
    clearSessionCookie();
    window.location.assign("/login");
    return WORKSPACE_SESSION_EXPIRED;
  }
  if (!res.ok) {
    throw new WorkspaceApiError(res.status, `The server returned ${res.status}. Try again in a moment.`);
  }
  return (await res.json()) as WorkspaceStatusResponse;
}

/** POST /api/workspace. Throws WorkspaceApiError with a human-readable
 *  message and the raw error code (so the form can special-case
 *  'already_has_organization' if it ever needs to). */
export async function createWorkspace(input: {
  name: string;
  timezone?: string;
}): Promise<CreateWorkspaceResponse> {
  let res: Response;
  try {
    res = await authedFetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new WorkspaceApiError(0, "Couldn't reach the server. Check your connection and try again.");
  }

  const body: unknown = await res.json().catch(() => null);

  if (res.status === 401) {
    clearSessionCookie();
    window.location.assign("/login");
    throw new WorkspaceApiError(401, "Your session expired. Signing you out.");
  }
  if (!res.ok) {
    const code = (body as DashboardApiErrorResponse | null)?.error;
    if (code === "already_has_organization") {
      throw new WorkspaceApiError(409, "This account already has a workspace.", code);
    }
    if (code === "invalid_body") {
      throw new WorkspaceApiError(400, "Enter a business name to continue.", code);
    }
    throw new WorkspaceApiError(res.status, "Something went wrong on our end. Try again in a moment.", code);
  }

  return body as CreateWorkspaceResponse;
}
