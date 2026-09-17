/**
 * Typed mock data for the Solo Sam dashboard (brief §10.2) until the Step-9
 * API routes land. Types come from `@tradescheduler/shared` (types-only pkg).
 *
 * Conventions:
 * - `startTime`/`endTime` are real ISO instants, generated so the wall-clock
 *   time in the business timezone is exactly what the UI shows (brief §9 Q8
 *   ruling — business timezone is the display timezone).
 * - One today job is *past its start*, so the "Needs attention" escalation
 *   affordance (§5.3) renders. The full Step-9 surface needs an
 *   `Escalation.bookingId` link (brief §9 Q3 — approved for now as this
 *   web-local affordance only).
 * - `status: "completed"` is web-local only (brief §9 Q1 ruling) — the shared
 *   `BookingStatus` stays `'pending' | 'confirmed' | 'rescheduled'`.
 *
 * DEV toggles (brief §10.3 AC3): append `?state=loading|error` or `?empty=1`
 * to a dashboard URL to render the loading / error / empty states without
 * code changes. Remove together with this module when APIs land.
 */
import type { Booking, BookingStatus, Escalation, RescheduleLogEntry, SmsMessage, User } from "@tradescheduler/shared"

import { wallClockParts } from "@/lib/format"

// ── types ────────────────────────────────────────────────────────────────

export type LoadState = "loading" | "error" | "ready"

export type FixtureFlags = {
  /** Drives skeleton / alert / content rendering. Flip to verify states. */
  loadState: LoadState
  /** When true, today renders the "No jobs today" empty state. */
  emptyToday: boolean
}

/**
 * Brief §9 Q1 (approved web-local): 'completed' exists only in the dashboard
 * UI. The shared schema is untouched.
 */
export type DashboardBooking = Omit<Booking, "status"> & {
  status: BookingStatus | "completed"
}

export type DashboardState = {
  bookings: DashboardBooking[]
  escalations: Escalation[]
  user: User
  flags: FixtureFlags
}

export const TRADE_LABEL = "Sam" // fixtures only; the real display name comes from auth/profile

// ── identity ─────────────────────────────────────────────────────────────

let idSeq = 0
function nextId(): string {
  return `00000000-0000-4000-8000-${String(++idSeq).padStart(12, "0")}`
}

export const userFixture: User = {
  id: "00000000-0000-4000-8000-000000000000",
  phoneNumber: "+12125551234",
  googleCalendarId: null,
  businessHours: {
    start: "07:00",
    end: "19:00",
    timezone: "America/New_York",
  },
  smsSettings: {
    rescheduleTemplate:
      "Hi {name}, here are some times we could move your booking to: {slot1}, {slot2}, or {slot3}. Reply 1, 2 or 3 to pick one.",
  },
}

// ── zoned clock helpers (Intl only — no tz library) ──────────────────────

const dayIndex = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86400000)

/** Build an ISO instant whose wall-clock time in `tz` is exactly y/m/d h:mm. */
function zonedIso(y: number, m: number, d: number, h: number, min: number, tz: string): string {
  let ms = Date.UTC(y, m - 1, d, h, min)
  for (let i = 0; i < 5; i++) {
    const got = wallClockParts(new Date(ms).toISOString(), tz)
    const want = { year: y, month: m, day: d, hour: h, minute: min }
    if (
      got.year === want.year &&
      got.month === want.month &&
      got.day === want.day &&
      got.hour === want.hour &&
      got.minute === want.minute
    ) {
      break
    }
    const delta =
      (dayIndex(got.year, got.month, got.day) - dayIndex(y, m, d)) * 1440 +
      (got.hour - h) * 60 +
      (got.minute - min)
    if (delta === 0) break
    ms += delta * 60000
  }
  return new Date(ms).toISOString()
}

// ── booking seeds ────────────────────────────────────────────────────────

type BookingSeed = {
  dayOffset: number // business-tz days from today
  start: [number, number] // wall-clock [h, mm] in the business tz
  durationMin: number
  status: BookingStatus
  customerName: string
  serviceDescription: string
  phone: string // E.164
  rescheduleLog?: RescheduleLogEntry[]
  rescheduledFromId?: string | null
}

function makeBooking(seed: BookingSeed, tz: string, now: Date): DashboardBooking {
  const today = wallClockParts(now.toISOString(), tz)
  const startIso = zonedIso(today.year, today.month, today.day + seed.dayOffset, seed.start[0], seed.start[1], tz)
  const endIso = new Date(new Date(startIso).getTime() + seed.durationMin * 60000).toISOString()
  return {
    id: nextId(),
    userId: userFixture.id,
    customerPhone: seed.phone,
    customerName: seed.customerName,
    serviceDescription: seed.serviceDescription,
    startTime: startIso,
    endTime: endIso,
    status: seed.status,
    depositStatus: seed.status === "rescheduled" ? "transferred" : "paid",
    googleCalendarEventId: null,
    smsHistory: [] as SmsMessage[],
    rescheduledFromId: seed.rescheduledFromId ?? null,
    rescheduleLog: seed.rescheduleLog ?? [],
  }
}

/**
 * The unconfirmed job that's already past its start — guarantees the
 * "Needs attention" affordance (§3.1 edge / §5.3) renders: start = now − 45min
 * floored to the previous 15-min boundary, clamped to 07:00 business-tz
 * today so it never lands on yesterday.
 */
function makePastStartBooking(tz: string, now: Date): DashboardBooking {
  const today = wallClockParts(now.toISOString(), tz)
  const floored = Math.floor((now.getTime() - 45 * 60000) / 900000) * 900000
  let startIso = new Date(floored).toISOString()
  if (wallClockParts(startIso, tz).key !== today.key) {
    startIso = zonedIso(today.year, today.month, today.day, 7, 0, tz)
  }
  const endIso = new Date(new Date(startIso).getTime() + 120 * 60000).toISOString()
  return {
    id: nextId(),
    userId: userFixture.id,
    customerPhone: "+15553456789",
    customerName: "Maria Rivera",
    serviceDescription: "Kitchen faucet replacement",
    startTime: startIso,
    endTime: endIso,
    status: "pending",
    depositStatus: "paid",
    googleCalendarEventId: null,
    smsHistory: [] as SmsMessage[],
    rescheduledFromId: null,
    rescheduleLog: [],
  }
}

/**
 * Today: 3 jobs, morning → evening, matching the §4.1 summary mock
 * (3 jobs · 1 unconfirmed · 2 confirmed; rescheduled counts into the
 * confirmed bucket per the mock). Sorting is by startTime at render — the
 * urgent card stays in time order per §4.1 (never yanked to the top).
 */
const seeds: BookingSeed[] = [
  {
    dayOffset: 0,
    start: [12, 30],
    durationMin: 90,
    status: "confirmed",
    customerName: "David Kim",
    serviceDescription: "Water heater leak check",
    phone: "+15551234567",
  },
  {
    dayOffset: 0,
    start: [17, 0],
    durationMin: 90,
    status: "rescheduled",
    customerName: "Jen Park",
    serviceDescription: "Furnace tune-up",
    phone: "+15552345678",
    rescheduledFromId: nextId(),
    rescheduleLog: [
      {
        action: "reschedule-offer",
        timestamp: zonedIso(2026, 9, 14, 14, 0, userFixture.businessHours.timezone),
        details: "Offered Tue 4–6pm, Wed 8–10am, Fri 3–5pm.",
      },
      {
        action: "reschedule-completed",
        timestamp: zonedIso(2026, 9, 14, 14, 20, userFixture.businessHours.timezone),
        details: "Customer confirmed by text.",
      },
    ],
  },
  // ── the week ahead ──
  {
    dayOffset: 1,
    start: [9, 0],
    durationMin: 60,
    status: "confirmed",
    customerName: "Carlos Mendez",
    serviceDescription: "Bathroom sink drain",
    phone: "+15554567890",
  },
  {
    dayOffset: 2,
    start: [10, 30],
    durationMin: 90,
    status: "rescheduled",
    customerName: "Anna Schmidt",
    serviceDescription: "Garbage disposal replacement",
    phone: "+15555678901",
    rescheduledFromId: nextId(),
    rescheduleLog: [
      {
        action: "reschedule-completed",
        timestamp: zonedIso(2026, 9, 15, 9, 5, userFixture.businessHours.timezone),
        details: "Customer called to move the visit.",
      },
    ],
  },
  // dayOffset 3 → intentionally NO jobs (empty-day state for the week view)
  {
    dayOffset: 4,
    start: [8, 0],
    durationMin: 60,
    status: "confirmed",
    customerName: "Tom O'Neil",
    serviceDescription: "Toilet running",
    phone: "+15556789012",
  },
  {
    dayOffset: 4,
    start: [14, 0],
    durationMin: 60,
    status: "confirmed",
    customerName: "Priya Shah",
    serviceDescription: "Outdoor spigot leak",
    phone: "+15557890123",
  },
  {
    dayOffset: 5,
    start: [9, 0],
    durationMin: 60,
    status: "confirmed",
    customerName: "Elena Cruz",
    serviceDescription: "Water softener check",
    phone: "+15558901234",
  },
  // dayOffset 6 → intentionally NO jobs (weekend)
]

// ── store (module singleton, useSyncExternalStore-compatible) ────────────

function createInitialState(): DashboardState {
  const now = new Date()
  const tz = userFixture.businessHours.timezone
  const bookings: DashboardBooking[] = seeds.map((s) => makeBooking(s, tz, now))
  bookings.push(makePastStartBooking(tz, now))
  const escalations: Escalation[] = [
    {
      id: nextId(),
      type: "ambiguous_intent",
      customerPhone: "+15553456789",
      content: "can we do it later in the week maybe after 4? not sure",
      status: "pending",
      createdAt: new Date(now.getTime() - 22 * 60_000).toISOString(),
      resolvedAt: null,
    },
    {
      id: nextId(),
      type: "no_availability",
      customerPhone: "+15554567890",
      content: "No open slots matched the customer's preferred window.",
      status: "pending",
      createdAt: new Date(now.getTime() - 95 * 60_000).toISOString(),
      resolvedAt: null,
    },
    {
      id: nextId(),
      type: "sms_delivery_failure",
      customerPhone: "+15555678901",
      content: "Outbound offer SMS failed to deliver (error 30007).",
      status: "resolved",
      createdAt: new Date(now.getTime() - 26 * 3_600_000).toISOString(),
      resolvedAt: new Date(now.getTime() - 24 * 3_600_000).toISOString(),
    },
  ]
  return {
    bookings,
    escalations,
    user: userFixture,
    flags: { loadState: "ready", emptyToday: false },
  }
}

const listeners = new Set<() => void>()
let state = createInitialState()

export function getDashboardState(): DashboardState {
  return state
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function publish(next: DashboardState) {
  state = next
  for (const listener of listeners) listener()
}

/** Q1 web-local mark-done: flips a booking to 'completed' in the store only. */
export function markBookingDone(id: string) {
  publish({
    ...state,
    bookings: state.bookings.map((b) => (b.id === id ? { ...b, status: "completed" } : b)),
  })
}

/** Resolves an escalation in the fixture store (web-local until the API lands). */
export function resolveEscalation(id: string) {
  publish({
    ...state,
    escalations: state.escalations.map((e) =>
      e.id === id ? { ...e, status: "resolved" as const, resolvedAt: new Date().toISOString() } : e
    ),
  })
}

/** Retry after an error: clears any ?state= override and returns to ready. */
export function retryLoad() {
  if (typeof window !== "undefined") {
    window.history.replaceState(null, "", window.location.pathname + window.location.hash)
  }
  publish({ ...state, flags: { ...state.flags, loadState: "ready", emptyToday: false } })
}