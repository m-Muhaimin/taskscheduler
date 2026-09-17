/**
 * Pure formatting helpers for the Solo Sam dashboard (brief §10.2 file map).
 *
 * Time convention (brief §9 Q8 ruling): every wall-clock display is rendered
 * in the tradesperson's `BusinessHours.timezone`; the header shows a tz label
 * only when the device timezone differs. Booking.startTime/endTime are ISO
 * instants (packages/shared), converted here with Intl — no tz library.
 */

const digitsOnly = (s: string) => s.replace(/\D/g, "")

/** E.164 → national display format, e.g. "+15550123456" → "(555) 012-3456". */
export function formatPhone(phone: string): string {
  const d = digitsOnly(phone)
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d
  if (n.length === 10) {
    return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`
  }
  return phone
}

/**
 * Display mask for phone numbers (brief §5.5). The brief's example shows
 * "(555) 012-3456" — national format with digits visible; the full E.164
 * number is only ever used inside `tel:` / `sms:` hrefs. Interpretation
 * recorded in the briefs ledger.
 */
export const maskPhone = formatPhone

/** Wall-clock date/time parts of an ISO instant in a given IANA timezone. */
export function wallClockParts(iso: string, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso))
  const p: Record<string, string> = {}
  for (const part of parts) p[part.type] = part.value
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    key: `${p.year}-${p.month}-${p.day}`,
  }
}

/** "08:00" — 24h HH:mm wall-clock in tz. */
export function formatTime(iso: string, tz: string): string {
  const p = wallClockParts(iso, tz)
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`
}

/** "08:00 – 10:30" */
export function formatTimeRange(startIso: string, endIso: string, tz: string): string {
  return `${formatTime(startIso, tz)} – ${formatTime(endIso, tz)}`
}

/** "Tue Sep 22" */
export function formatDateLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso))
}

/** "Tue" */
export function formatWeekdayShort(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(new Date(iso))
}

/** "yyyy-mm-dd" wall-clock day key in tz — used to bucket bookings per day. */
export function dayKey(iso: string, tz: string): string {
  return wallClockParts(iso, tz).key
}

/** Compact relative time: "now", "12m ago", "in 3h", "2d ago". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diffMin = Math.round((new Date(iso).getTime() - now.getTime()) / 60000)
  const abs = Math.abs(diffMin)
  if (abs < 1) return "now"
  if (abs < 60) return diffMin < 0 ? `${abs}m ago` : `in ${abs}m`
  if (abs < 60 * 24) {
    const h = Math.round(abs / 60)
    return diffMin < 0 ? `${h}h ago` : `in ${h}h`
  }
  const d = Math.round(abs / (60 * 24))
  return diffMin < 0 ? `${d}d ago` : `in ${d}d`
}

/** Short tz name for a label, e.g. "EDT". */
export function tzAbbr(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "short",
  }).formatToParts(new Date())
  const part = parts.find((p) => p.type === "timeZoneName")
  return part ? part.value : tz
}

/** Device timezone (client only; undefined during SSR). */
export function deviceTimezone(): string | undefined {
  if (typeof window === "undefined") return undefined
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * Pre-filled SMS body (brief §5.5):
 * "Hi {name}, it's {trade} about your {service} on {date}."
 */
export function buildSmsBody(args: {
  customerName: string
  tradeLabel: string
  serviceDescription: string
  dateLabel: string
}): string {
  return `Hi ${args.customerName}, it's ${args.tradeLabel} about your ${args.serviceDescription} on ${args.dateLabel}.`
}

/** `sms:` href with a pre-filled body. */
export function smsHref(phone: string, body: string): string {
  return `sms:${phone}?body=${encodeURIComponent(body)}`
}