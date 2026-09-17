"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeftIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { JobDetailBody, JobDetailFooter } from "@/components/job-detail-body"
import { useDashboardData } from "@/lib/use-dashboard-data"

/** Desktop (and deep-link) job detail — §9 Q7. Mobile uses the bottom sheet. */
export default function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const { bookings, businessTz, tradeLabel } = useDashboardData()
  const booking = bookings.find((b) => b.id === jobId)

  if (!booking) {
    return (
      <Card className="border border-border py-12 text-center shadow-none ring-0">
        <p className="text-base font-medium">Job not found.</p>
        <p className="mt-1 text-sm text-muted-foreground">It may have been removed.</p>
        <Button asChild variant="secondary" className="mt-4 h-11">
          <Link href="/dashboard">Back to today</Link>
        </Button>
      </Card>
    )
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-3">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Back to today
      </Link>
      <Card className="border border-border p-0 shadow-none ring-0">
        <div className="p-6 pb-2">
          <JobDetailBody booking={booking} tz={businessTz} tradeLabel={tradeLabel} />
        </div>
        <div className="border-t p-4">
          <JobDetailFooter booking={booking} tz={businessTz} tradeLabel={tradeLabel} />
        </div>
      </Card>
    </div>
  )
}