import type { DashboardBooking } from "@/lib/fixtures"

/**
 * Booking status label + badge variant mapping (brief §5.3 "core rule"):
 *   confirmed → default (blue) · pending → urgent (orange) · rescheduled → secondary
 *   completed → outline (muted)
 * Single source of truth — consumed by JobCard and JobDetailBody.
 */
export const STATUS_LABEL: Record<DashboardBooking["status"], string> = {
  pending: "Unconfirmed",
  confirmed: "Confirmed",
  rescheduled: "Rescheduled",
  completed: "Completed",
}

export type StatusBadgeVariant = "default" | "secondary" | "outline" | "urgent"

/** Badge variant per status. `completed` still applies muted text at the call site. */
export function statusBadgeVariant(status: DashboardBooking["status"]): StatusBadgeVariant {
  if (status === "confirmed") return "default"
  if (status === "pending") return "urgent"
  if (status === "rescheduled") return "secondary"
  return "outline"
}
