"use client"

import { useState, type ReactNode } from "react"
import { MessageSquareIcon, PhoneIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { buildSmsBody, formatDateLabel, formatTimeRange, maskPhone, relativeTime, smsHref } from "@/lib/format"
import { type DashboardBooking } from "@/lib/fixtures"
import { useDashboardData } from "@/lib/use-dashboard-data"
import { cn } from "@/lib/utils"

const STATUS_LABEL: Record<DashboardBooking["status"], string> = {
  pending: "Unconfirmed",
  confirmed: "Confirmed",
  rescheduled: "Rescheduled",
  completed: "Completed",
}

const RESCHEDULE_ACTION_LABEL: Record<string, string> = {
  "reschedule-offer": "Reschedule offered",
  "reschedule-confirm": "Confirmed by customer",
  "reschedule-completed": "Rescheduled",
  "reschedule-failed": "Reschedule failed",
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  )
}

/** Job detail body (brief §5.4): header, service/time/phone rows, reschedule log. */
export function JobDetailBody({
  booking,
  tz,
  tradeLabel,
}: {
  booking: DashboardBooking
  tz: string
  tradeLabel: string
}) {
  const needsAttention =
    booking.status === "pending" && new Date(booking.startTime).getTime() < Date.now()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={
            booking.status === "confirmed"
              ? "default"
              : booking.status === "rescheduled"
                ? "secondary"
                : "outline"
          }
          className={cn(
            booking.status === "pending" && "border-urgent/30 bg-urgent-soft text-urgent-soft-foreground",
            booking.status === "completed" && "border-border text-muted-foreground"
          )}
        >
          {STATUS_LABEL[booking.status]}
        </Badge>
        {needsAttention && (
          <Badge
            aria-label="Needs attention"
            className="border-urgent/30 bg-urgent-soft text-urgent-soft-foreground"
          >
            <span className="size-1.5 rounded-full bg-urgent" aria-hidden="true" />
            Needs attention
          </Badge>
        )}
      </div>
      <h2 className="text-lg font-semibold">{booking.customerName}</h2>
      <Separator />
      <dl className="space-y-3">
        <InfoRow label="Service">{booking.serviceDescription}</InfoRow>
        <InfoRow label="Time">
          <span className="tabular-nums">{formatTimeRange(booking.startTime, booking.endTime, tz)}</span>
          <span className="ml-1.5 text-muted-foreground">{formatDateLabel(booking.startTime, tz)}</span>
        </InfoRow>
        <InfoRow label="Phone">
          <span className="tabular-nums">{maskPhone(booking.customerPhone)}</span>
        </InfoRow>
      </dl>
      <Separator />
      <div>
        <h3 className="text-sm font-medium text-muted-foreground">Reschedule history</h3>
        {booking.rescheduleLog.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No reschedules yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {booking.rescheduleLog.map((entry, i) => (
              <li key={i} className="flex items-start justify-between gap-4 text-sm">
                <span>{RESCHEDULE_ACTION_LABEL[entry.action] ?? entry.action}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {relativeTime(entry.timestamp)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Job detail footer (brief §5.5): Call / Text / Mark done (confirm dialog). */
export function JobDetailFooter({
  booking,
  tz,
  tradeLabel,
  onDone,
}: {
  booking: DashboardBooking
  tz: string
  tradeLabel: string
  onDone?: () => void
}) {
  const { markDone } = useDashboardData()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const alreadyDone = booking.status === "completed"

  const smsBody = buildSmsBody({
    customerName: booking.customerName,
    tradeLabel,
    serviceDescription: booking.serviceDescription,
    dateLabel: formatDateLabel(booking.startTime, tz),
  })

  const handleConfirm = () => {
    setConfirming(true)
    // Fixture store — resolves synchronously (no API until a later step).
    markDone(booking.id)
    toast.success("Job marked done")
    setConfirming(false)
    setConfirmOpen(false)
    onDone?.()
  }

  return (
    <div className="w-full space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Button asChild className="h-12 w-full">
          <a href={`tel:${booking.customerPhone}`} aria-label={`Call ${booking.customerName}`}>
            <PhoneIcon className="size-4" />
            Call
          </a>
        </Button>
        <Button asChild variant="secondary" className="h-12 w-full">
          <a href={smsHref(booking.customerPhone, smsBody)} aria-label={`Text ${booking.customerName}`}>
            <MessageSquareIcon className="size-4" />
            Text
          </a>
        </Button>
      </div>
      {!alreadyDone && (
        <Button variant="outline" className="h-11 w-full" onClick={() => setConfirmOpen(true)}>
          Mark done
        </Button>
      )}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark done?</DialogTitle>
            <DialogDescription>This moves the job to completed.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={confirming}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={confirming}>
              {confirming ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}