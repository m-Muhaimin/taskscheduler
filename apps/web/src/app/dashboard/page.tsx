"use client"

import { useState } from "react"
import Link from "next/link"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { JobCard } from "@/components/job-card"
import { JobDetailSheet } from "@/components/job-detail-sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { SummaryStrip } from "@/components/summary-strip"
import { dayKey } from "@/lib/format"
import { type DashboardBooking } from "@/lib/fixtures"
import { useDashboardData } from "@/lib/use-dashboard-data"

/** Today (brief §5.2): summary strip + job list; mobile opens the detail sheet. */
export default function TodayPage() {
  const { loadState, emptyToday, bookings, businessTz, tradeLabel, retry } = useDashboardData()
  const [selected, setSelected] = useState<DashboardBooking | null>(null)

  const todayKey = dayKey(new Date().toISOString(), businessTz)
  const today = bookings
    .filter((b) => dayKey(b.startTime, businessTz) === todayKey)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  const visible = emptyToday ? [] : today // `?empty=1` also zeroes the summary
  const unconfirmed = visible.filter((b) => b.status === "pending").length

  const showEmpty = loadState === "ready" && visible.length === 0
  const selectedBooking = selected ? bookings.find((b) => b.id === selected.id) ?? null : null

  return (
    <div className="space-y-4">
      <SummaryStrip
        loading={loadState === "loading"}
        error={loadState === "error"}
        total={visible.length}
        unconfirmed={unconfirmed}
        confirmed={visible.length - unconfirmed}
      />

      {loadState === "loading" && (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load today&apos;s jobs.</AlertTitle>
          <AlertDescription>Check your connection and try again.</AlertDescription>
          <AlertAction>
            <Button size="sm" onClick={retry}>
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}

      {showEmpty && (
        <Card className="border border-border py-12 text-center shadow-none ring-0">
          <p className="text-base font-medium">No jobs today — enjoy the day off.</p>
          <Button asChild variant="secondary" className="mt-4 h-11">
            <Link href="/dashboard/week">See the week</Link>
          </Button>
        </Card>
      )}

      {loadState === "ready" && visible.length > 0 && (
        <div className="space-y-3">
          {visible.map((b) => (
            <JobCard
              key={b.id}
              booking={b}
              tz={businessTz}
              tradeLabel={tradeLabel}
              onOpen={() => setSelected(b)}
            />
          ))}
        </div>
      )}

      {selectedBooking && (
        <JobDetailSheet
          booking={selectedBooking}
          tz={businessTz}
          tradeLabel={tradeLabel}
          open
          onOpenChange={() => setSelected(null)}
        />
      )}
    </div>
  )
}