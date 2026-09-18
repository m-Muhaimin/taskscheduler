"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card } from "@/components/ui/card"
import { JobCard } from "@/components/job-card"
import { JobDetailSheet } from "@/components/job-detail-sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { DayStrip, type DayChip } from "@/components/day-strip"
import { dayKey, formatDateLabel, formatWeekdayShort, wallClockParts } from "@/lib/format"
import { type DashboardBooking } from "@/lib/fixtures"
import { useDashboardData } from "@/lib/use-dashboard-data"

/** Business-tz Monday–Sunday week (Q4: weeks start Monday). */
function buildWeekDays(tz: string, now: Date): DayChip[] {
  const today = wallClockParts(now.toISOString(), tz)
  const mondayOffset = (new Date(now).getDay() + 6) % 7 // Mon = 0
  const days: DayChip[] = []
  for (let i = -mondayOffset; i < 7 - mondayOffset; i++) {
    const iso = new Date(now.getTime() + i * 86_400_000).toISOString()
    const parts = wallClockParts(iso, tz)
    days.push({
      key: parts.key,
      iso,
      weekday: formatWeekdayShort(iso, tz),
      dayNum: String(parts.day),
      isToday: parts.key === today.key,
    })
  }
  return days
}

export default function WeekPage() {
  const { loadState, bookings, businessTz, tradeLabel, retry } = useDashboardData()
  const [now] = useState(() => new Date())
  const days = useMemo(() => buildWeekDays(businessTz, now), [businessTz, now])
  const [selectedKey, setSelectedKey] = useState(() => dayKey(now.toISOString(), businessTz))
  const [selectedSheet, setSelectedSheet] = useState<DashboardBooking | null>(null)

  const byDay: Record<string, DashboardBooking[]> = {}
  for (const b of bookings) {
    const key = dayKey(b.startTime, businessTz)
    ;(byDay[key] ??= []).push(b)
  }
  for (const key of Object.keys(byDay)) {
    byDay[key].sort((a, b) => a.startTime.localeCompare(b.startTime))
  }

  const hasAny = days.some((d) => (byDay[d.key]?.length ?? 0) > 0)
  const selectedDay = days.find((d) => d.key === selectedKey)
  const selectedJobs = byDay[selectedKey] ?? []
  const selectedDate = new Date(`${selectedKey}T12:00:00`)

  // Start-of-today in business tz, as UTC ms — past dates disabled (today stays selectable).
  const today = wallClockParts(now.toISOString(), businessTz)
  const todayStart = Date.UTC(today.year, today.month - 1, today.day)

  const selectedBooking = selectedSheet
    ? bookings.find((b) => b.id === selectedSheet.id) ?? null
    : null

  return (
    <div className="space-y-4">
      {loadState === "loading" && (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load the week.</AlertTitle>
          <AlertDescription>Check your connection and try again.</AlertDescription>
          <AlertAction>
            <Button size="sm" onClick={retry}>
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}

      {loadState === "ready" && (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="hidden lg:block">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(d) => d && setSelectedKey(dayKey(d.toISOString(), businessTz))}
              weekStartsOn={1}
              disabled={(d) => d.getTime() < todayStart}
              className="rounded-md border"
            />
          </div>

          <div className="min-w-0 space-y-4">
            <div className="lg:hidden">
              <DayStrip days={days} value={selectedKey} onValueChange={setSelectedKey} />
            </div>

            {!hasAny && (
              <Card className="py-12 text-center">
                <p className="text-base font-medium">Nothing booked this week.</p>
                <p className="mt-1 text-sm text-muted-foreground">Plenty of time to chase new leads.</p>
                <Button asChild variant="secondary" className="mt-4 h-11">
                  <Link href="/dashboard">Back to today</Link>
                </Button>
              </Card>
            )}

            {hasAny && (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium text-muted-foreground">
                    {selectedDay ? formatDateLabel(selectedDay.iso, businessTz) : ""}
                  </h2>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {selectedJobs.length === 0
                      ? "No jobs"
                      : `${selectedJobs.length} job${selectedJobs.length === 1 ? "" : "s"}`}
                  </span>
                </div>
                {selectedJobs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing booked that day.</p>
                ) : (
                  <div className="space-y-3">
                    {selectedJobs.map((b) => (
                      <JobCard
                        key={b.id}
                        booking={b}
                        tz={businessTz}
                        tradeLabel={tradeLabel}
                        onOpen={() => setSelectedSheet(b)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {selectedBooking && (
        <JobDetailSheet
          booking={selectedBooking}
          tz={businessTz}
          tradeLabel={tradeLabel}
          open
          onOpenChange={() => setSelectedSheet(null)}
        />
      )}
    </div>
  )
}