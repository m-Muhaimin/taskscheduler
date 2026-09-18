/**
 * Domain fixtures for the Tradescheduler dashboard.
 * 
 * NOTE: In v1, these are local-only mocks. The data will move to the
 * Supabase database in Phase 2.
 */
import type { Booking, BookingStatus, Escalation, RescheduleLogEntry, SmsMessage, User } from "@tradescheduler/shared"
import { wallClockParts } from "@/lib/format"

export type LoadState = "loading" | "error" | "ready"

export type FixtureFlags = {
  loadState: LoadState
  emptyToday: boolean
}

export type DashboardBooking = Omit<Booking, "status"> & {
  status: BookingStatus | "completed"
}

export type DashboardState = {
  bookings: DashboardBooking[]
  escalations: Escalation[]
  user: User
  flags: FixtureFlags
}

export const TRADE_LABEL = "Sam"

let idSeq = 0
function nextId(): string {
  return `00000000-0000-4000-8000-${String(++idSeq).padStart(12, "0")}`
}

export const userFixture: User = {
  id: "user_demo_01",
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

function zonedIso(y: number, m: number, d: number, h: number, min: number, tz: string): string {
  let ms = Date.UTC(y, m - 1, d, h, min)
  for (let i = 0; i < 5; i++) {
    const got = wallClockParts(new Date(ms).toISOString(), tz)
    const want = { year: y, month: m, day: d, hour: h, minute: min }
    if (got.year === want.year && got.month === want.month && got.day === want.day && got.hour === want.hour && got.minute === want.minute) break
    const delta = (Math.floor(Date.UTC(got.year, got.month, got.day) / 86400000) - Math.floor(Date.UTC(y, m - 1, d) / 86400000)) * 1440 + (got.hour - h) * 60 + (got.minute - min)
    if (delta === 0) break
    ms += delta * 60000
  }
  return new Date(ms).toISOString()
}

function makeBooking(dayOffset: number, start: [number, number], durationMin: number, status: BookingStatus, customerName: string, serviceDescription: string, phone: string, tz: string, now: Date): DashboardBooking {
  const today = wallClockParts(now.toISOString(), tz)
  const startIso = zonedIso(today.year, today.month, today.day + dayOffset, start[0], start[1], tz)
  const endIso = new Date(new Date(startIso).getTime() + durationMin * 60000).toISOString()
  return {
    id: nextId(),
    userId: userFixture.id,
    customerPhone: phone,
    customerName: customerName,
    serviceDescription: serviceDescription,
    startTime: startIso,
    endTime: endIso,
    status: status,
    depositStatus: status === "rescheduled" ? "transferred" : "paid",
    googleCalendarEventId: null,
    smsHistory: [],
    rescheduledFromId: null,
    rescheduleLog: [],
  }
}

function createInitialState(): DashboardState {
  const now = new Date()
  const tz = userFixture.businessHours.timezone
  const bookings: DashboardBooking[] = [
    makeBooking(0, [12, 30], 90, "confirmed", "David Kim", "Water heater leak check", "+15551234567", tz, now),
    makeBooking(0, [17, 0], 90, "rescheduled", "Jen Park", "Furnace tune-up", "+15552345678", tz, now),
    makeBooking(1, [9, 0], 60, "confirmed", "Carlos Mendez", "Bathroom sink drain", "+15554567890", tz, now),
    makeBooking(2, [10, 30], 90, "rescheduled", "Anna Schmidt", "Garbage disposal replacement", "+15555678901", tz, now),
    makeBooking(4, [8, 0], 60, "confirmed", "Tom O'Neil", "Toilet running", "+15556789012", tz, now),
    makeBooking(4, [14, 0], 60, "confirmed", "Priya Shah", "Outdoor spigot leak", "+15557890123", tz, now),
    makeBooking(5, [9, 0], 60, "confirmed", "Elena Cruz", "Water softener check", "+15558901234", tz, now),
  ]
  
  // Add one that's past its start to trigger "Needs attention"
  const today = wallClockParts(now.toISOString(), tz)
  const pastStart = zonedIso(today.year, today.month, today.day, 7, 0, tz)
  bookings.push({
    id: nextId(),
    userId: userFixture.id,
    customerPhone: "+15553456789",
    customerName: "Maria Rivera",
    serviceDescription: "Kitchen faucet replacement",
    startTime: pastStart,
    endTime: new Date(new Date(pastStart).getTime() + 120 * 60000).toISOString(),
    status: "pending",
    depositStatus: "paid",
    googleCalendarEventId: null,
    smsHistory: [],
    rescheduledFromId: null,
    rescheduleLog: [],
  })

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

export function markBookingDone(id: string) {
  publish({
    ...state,
    bookings: state.bookings.map((b) => (b.id === id ? { ...b, status: "completed" } : b)),
  })
}

export function resolveEscalation(id: string) {
  publish({
    ...state,
    escalations: state.escalations.map((e) =>
      e.id === id ? { ...e, status: "resolved" as const, resolvedAt: new Date().toISOString() } : e
    ),
  })
}

export function retryLoad() {
  if (typeof window !== "undefined") {
    window.history.replaceState(null, "", window.location.pathname + window.location.hash)
  }
  publish({ ...state, flags: { ...state.flags, loadState: "ready", emptyToday: false } })
}
