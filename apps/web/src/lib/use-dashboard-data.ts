"use client"

import { useMemo, useSyncExternalStore } from "react"

import {
  getDashboardState,
  markBookingDone,
  retryLoad,
  subscribe,
  TRADE_LABEL,
  userFixture,
  type DashboardState,
  type LoadState,
} from "@/lib/fixtures"

/**
 * DEV toggles (brief §10.3 AC3): `?state=loading|error` and `?empty=1` on any
 * dashboard URL override the fixture flags so the loading / error / empty
 * states are verifiable without code changes. Remove with the fixtures.
 */
function overrideFromLocation(): { loadState?: LoadState; emptyToday?: boolean } {
  if (typeof window === "undefined") return {}
  const params = new URLSearchParams(window.location.search)
  const state = params.get("state")
  return {
    loadState: state === "loading" || state === "error" ? state : undefined,
    emptyToday: params.get("empty") === "1" ? true : undefined,
  }
}

/**
 * Server snapshot (React 19 requirement): pages are client-data dashboards, so
 * SSR/hydration renders the loading state and swaps to real fixture data only
 * after hydration — no server/client mismatch on dates or bookings.
 */
function getServerSnapshot(): DashboardState {
  return { flags: { loadState: "loading", emptyToday: false }, bookings: [], user: userFixture }
}

export function useDashboardData() {
  const appState = useSyncExternalStore(subscribe, getDashboardState, getServerSnapshot)
  const override = useMemo(overrideFromLocation, [])
  const loadState: LoadState = override.loadState ?? appState.flags.loadState

  return {
    loadState,
    emptyToday: override.emptyToday ?? appState.flags.emptyToday,
    bookings: appState.bookings,
    user: appState.user,
    tradeLabel: TRADE_LABEL,
    businessTz: appState.user.businessHours.timezone,
    retry: retryLoad,
    markDone: markBookingDone,
  }
}

export type { LoadState }