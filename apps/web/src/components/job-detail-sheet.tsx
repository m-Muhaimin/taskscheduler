"use client"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { JobDetailBody, JobDetailFooter } from "@/components/job-detail-body"
import { type DashboardBooking } from "@/lib/fixtures"

/**
 * Mobile job detail (brief §5.4/§9 Q7): bottom sheet, 85dvh max, rounded top,
 * scrollable body, footer stuck to the bottom edge. Desktop route
 * (/dashboard/jobs/[jobId]) renders the same body/footer components.
 */
export function JobDetailSheet({
  booking,
  tz,
  tradeLabel,
  open,
  onOpenChange,
}: {
  booking: DashboardBooking
  tz: string
  tradeLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto w-full max-w-xl gap-0 overflow-hidden rounded-t-xl p-0"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{booking.customerName}</SheetTitle>
          <SheetDescription>Job details</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2 pt-5">
          <JobDetailBody booking={booking} tz={tz} tradeLabel={tradeLabel} />
        </div>
        <SheetFooter className="w-full border-t bg-background p-4">
          <JobDetailFooter booking={booking} tz={tz} tradeLabel={tradeLabel} onDone={() => onOpenChange(false)} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}