"use client"

import Link from "next/link"
import { MessageSquareIcon, PhoneIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useIsDesktop } from "@/hooks/use-media-query"
import { buildSmsBody, formatDateLabel, formatTime, maskPhone, smsHref } from "@/lib/format"
import { type DashboardBooking } from "@/lib/fixtures"
import { cn } from "@/lib/utils"

const STATUS_LABEL: Record<DashboardBooking["status"], string> = {
  pending: "Unconfirmed",
  confirmed: "Confirmed",
  rescheduled: "Rescheduled",
  completed: "Completed",
}

/**
 * Job list card (brief §5.3). Flat card (nova base overridden: border, no ring)
 * with a 4px left accent by status:
 *   pending     → urgent (orange) — "needs attention" when start is in the past
 *   confirmed   → primary
 *   rescheduled → muted (slate invisible on white)
 *   completed   → border
 * Top zone is one link (desktop) / button (mobile, opens the bottom sheet) —
 * the status badge and quick actions live in the footer so nothing nests
 * inside an interactive element.
 */
export function JobCard({
  booking,
  tz,
  tradeLabel,
  onOpen,
}: {
  booking: DashboardBooking
  tz: string
  tradeLabel: string
  onOpen: () => void
}) {
  const isDesktop = useIsDesktop()
  const needsAttention =
    booking.status === "pending" && new Date(booking.startTime).getTime() < Date.now()

  const accent = cn(
    "border-l-4",
    booking.status === "pending" && "border-l-urgent",
    booking.status === "confirmed" && "border-l-primary",
    booking.status === "rescheduled" && "border-l-muted-foreground/30",
    booking.status === "completed" && "border-l-border"
  )

  const hoverAffordance = cn(
    needsAttention ? "hover:border-urgent/40" : "hover:border-primary/40",
    "hover:border-r-primary/40 hover:border-b-primary/40",
    "active:scale-[0.99] transition-[transform,border-color]"
  )

  // Contact affordances — real tel:/sms: with full E.164 (§9 maskPhone ruling:
  // digits shown masked on screen, full number only in the hrefs).
  const smsBody = buildSmsBody({
    customerName: booking.customerName,
    tradeLabel,
    serviceDescription: booking.serviceDescription,
    dateLabel: formatDateLabel(booking.startTime, tz),
  })

  const linkZone = (
    <>
      <span className="flex items-center justify-between gap-2">
        <Badge variant="outline" className="text-sm tabular-nums normal-case">
          {formatTime(booking.startTime, tz)}
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
      </span>
      <span className="mt-2 block truncate text-base font-semibold">{booking.customerName}</span>
      <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
        {booking.serviceDescription}
      </span>
    </>
  )

  return (
    <Card className={cn("gap-0 border border-border p-0 shadow-none ring-0", accent)}>
      <CardContent className={cn("px-4 py-3", hoverAffordance)}>
        {isDesktop ? (
          <Link href={`/dashboard/jobs/${booking.id}`} className="block" aria-label={`Open ${booking.customerName} job details`}>
            {linkZone}
          </Link>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="block w-full text-left"
            aria-label={`Open ${booking.customerName} job details`}
          >
            {linkZone}
          </button>
        )}
      </CardContent>
      <div className="flex items-center justify-between border-t px-4 py-2">
        <div className="flex items-center gap-1.5">
          <Badge
            variant={
              booking.status === "confirmed"
                ? "default"
                : booking.status === "rescheduled"
                  ? "secondary"
                  : "outline"
            }
            className={cn(
              "h-5 px-2 text-[11px]",
              booking.status === "pending" && "border-urgent/30 bg-urgent-soft text-urgent-soft-foreground",
              booking.status === "completed" && "border-border text-muted-foreground"
            )}
          >
            {STATUS_LABEL[booking.status]}
          </Badge>
          <span className="text-sm text-muted-foreground tabular-nums">{maskPhone(booking.customerPhone)}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            aria-label={`Call ${booking.customerName}`}
          >
            <a href={`tel:${booking.customerPhone}`}>
              <PhoneIcon className="size-[18px]" />
            </a>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            aria-label={`Text ${booking.customerName}`}
          >
            <a href={smsHref(booking.customerPhone, smsBody)}>
              <MessageSquareIcon className="size-[18px]" />
            </a>
          </Button>
        </div>
      </div>
    </Card>
  )
}