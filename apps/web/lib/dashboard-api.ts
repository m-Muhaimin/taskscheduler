"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authedFetch, clearSessionCookie } from "@/lib/auth";
import type {
  DashboardAnalyticsResponse,
  DashboardCustomersResponse,
  DashboardInboxResponse,
  DashboardJobsResponse,
  DashboardScheduleResponse,
  DashboardSummaryResponse,
} from "@tradescheduler/shared";

/**
 * Dashboard data layer (T5). Typed helpers over authedFetch (lib/auth.ts)
 * calling RELATIVE /api/dashboard/* paths (proxied to the API by
 * next.config.mjs) and returning the T1 DTOs from @tradescheduler/shared.
 *
 * Error contract per brief:
 *  - 401                    -> session is stale/tampered: clear the cookie and
 *                              redirect to /login (SESSION_EXPIRED sentinel so
 *                              callers don't flash an error card mid-redirect).
 *  - 403 no_organization    -> NO_ORGANIZATION sentinel; pages render the
 *                              zero/empty (onboarding) state.
 *  - 5xx / network failure  -> throws DashboardApiError; pages show the
 *                              compact error card with retry.
 *
 * Thin by design: one fetch per page mount, no caching/retry layer.
 */

/** Sentinel: the signed-in user has no organization yet (403 no_organization). */
export const NO_ORGANIZATION = Symbol("no_organization");
export type NoOrganization = typeof NO_ORGANIZATION;

/** Sentinel: 401 — the login redirect is already in flight; ignore the result. */
export const SESSION_EXPIRED = Symbol("session_expired");

export class DashboardApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
  }
}

async function request<T>(path: string): Promise<T | NoOrganization | typeof SESSION_EXPIRED> {
  let res: Response;
  try {
    res = await authedFetch(path, { cache: "no-store" });
  } catch {
    throw new DashboardApiError(0, "Couldn't reach the dashboard service. Check your connection and try again.");
  }

  if (res.status === 401) {
    clearSessionCookie();
    window.location.assign("/login");
    return SESSION_EXPIRED;
  }

  if (res.status === 403) {
    const body: unknown = await res.json().catch(() => null);
    if ((body as { error?: string } | null)?.error === "no_organization") return NO_ORGANIZATION;
    throw new DashboardApiError(403, "You don't have access to this workspace.");
  }

  if (!res.ok) {
    throw new DashboardApiError(res.status, `The dashboard service returned ${res.status}. Try again in a moment.`);
  }

  return (await res.json()) as T;
}

export function getSummary(): Promise<DashboardSummaryResponse | NoOrganization | typeof SESSION_EXPIRED> {
  return request<DashboardSummaryResponse>("/api/dashboard/summary");
}

export function getInboxItems(): Promise<DashboardInboxResponse | NoOrganization | typeof SESSION_EXPIRED> {
  return request<DashboardInboxResponse>("/api/dashboard/inbox");
}

export function getWeekSchedule(
  weekStart?: string,
  weekEnd?: string,
): Promise<DashboardScheduleResponse | NoOrganization | typeof SESSION_EXPIRED> {
  const qs = new URLSearchParams();
  if (weekStart) qs.set("weekStart", weekStart);
  if (weekEnd) qs.set("weekEnd", weekEnd);
  const q = qs.toString();
  return request<DashboardScheduleResponse>(`/api/dashboard/schedule${q ? `?${q}` : ""}`);
}

export function getJobs(): Promise<DashboardJobsResponse | NoOrganization | typeof SESSION_EXPIRED> {
  return request<DashboardJobsResponse>("/api/dashboard/jobs");
}

export function getCustomers(): Promise<DashboardCustomersResponse | NoOrganization | typeof SESSION_EXPIRED> {
  return request<DashboardCustomersResponse>("/api/dashboard/customers");
}

export function getAnalytics(): Promise<DashboardAnalyticsResponse | NoOrganization | typeof SESSION_EXPIRED> {
  return request<DashboardAnalyticsResponse>("/api/dashboard/analytics");
}

// ── Load-state hook (one fetch per mount; retry re-runs the loader) ────────

export type DashboardLoad<T> =
  | { status: "loading" }
  /** 403 no_organization (or empty-by-design) — render the onboarding/empty card. */
  | { status: "empty" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

/**
 * Runs `loader` on mount and whenever `deps` change (schedule week nav passes
 * its week params), keeping a single in-flight fetch per key. `retry` re-fires
 * the current loader. The loader itself owns the 401 redirect; SESSION_EXPIRED
 * results are ignored so the page sits in its loading frame while the browser
 * navigates away.
 */
export function useDashboardData<T>(
  loader: () => Promise<T | NoOrganization | typeof SESSION_EXPIRED>,
  deps: readonly unknown[] = [],
): { state: DashboardLoad<T>; retry: () => void } {
  const [state, setState] = useState<DashboardLoad<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    loaderRef.current()
      .then((result) => {
        if (cancelled) return;
        if (result === SESSION_EXPIRED) return; // redirect to /login is in flight
        if (result === NO_ORGANIZATION) setState({ status: "empty" });
        else setState({ status: "ready", data: result });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error && err.message ? err.message : "Something went wrong. Try again.",
        });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the caller's fetch key
  }, [...deps, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { state, retry };
}