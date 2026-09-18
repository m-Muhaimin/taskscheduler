"use client"

import * as React from "react"
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { dayKey } from "@/lib/format"
import { type DashboardBooking } from "@/lib/fixtures"

/** Jobs booked per day for the last week, split by confirmation state. */
const WINDOW_DAYS = 7

const chartConfig = {
  confirmed: { label: "Confirmed", color: "var(--primary)" },
  unconfirmed: { label: "Unconfirmed", color: "var(--urgent)" },
} satisfies ChartConfig

type SeriesKey = keyof typeof chartConfig

type Point = { date: string; label: string } & Record<SeriesKey, number>

/** "2026-09-17" → "Wed 17" (UTC noon avoids any DST drift on the label). */
function shortLabel(key: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
  }).format(new Date(`${key}T12:00:00Z`))
}

function longLabel(key: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${key}T12:00:00Z`))
}

export function JobsChart({
  bookings,
  tz,
  loading,
}: {
  bookings: DashboardBooking[]
  tz: string
  loading: boolean
}) {
  const [hidden, setHidden] = React.useState<Record<string, boolean>>({})

  const data = React.useMemo<Point[]>(() => {
    const now = Date.now()
    // Walk back one day at a time in the business tz, de-duping so a DST
    // transition can never yield a repeated or skipped bucket.
    const keys: string[] = []
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) keys.push(dayKey(new Date(now - i * 86400000).toISOString(), tz))
    const days = [...new Set(keys)]

    const counts = new Map<string, { confirmed: number; unconfirmed: number }>()
    for (const k of days) counts.set(k, { confirmed: 0, unconfirmed: 0 })
    for (const b of bookings) {
      const bucket = counts.get(dayKey(b.startTime, tz))
      if (!bucket) continue // outside the window
      if (b.status === "pending") bucket.unconfirmed += 1
      else bucket.confirmed += 1
    }
    return days.map((k) => ({
      date: k,
      label: shortLabel(k),
      confirmed: counts.get(k)!.confirmed,
      unconfirmed: counts.get(k)!.unconfirmed,
    }))
  }, [bookings, tz])

  const series: SeriesKey[] = ["confirmed", "unconfirmed"]

  if (loading) {
    return (
      <Card className="py-0">
        <CardHeader className="px-3 pt-3 pb-2">
          <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Jobs this week
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          <Skeleton className="h-32 rounded-md" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="py-0">
      <CardHeader className="flex-row items-center justify-between gap-2 px-3 pt-3 pb-2">
        <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Jobs this week
        </CardTitle>
        <div className="flex items-center gap-1">
          {series.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={!hidden[key]}
              onClick={() => setHidden((h) => ({ ...h, [key]: !h[key] }))}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-2xs font-medium transition-colors",
                hidden[key]
                  ? "text-muted-foreground/50 line-through"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-xs"
                style={{ backgroundColor: `var(--color-${key})` }}
              />
              {chartConfig[key].label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-3">
        <ChartContainer config={chartConfig} className="aspect-auto h-32 w-full">
          <BarChart accessibilityLayer data={data} margin={{ left: 4, right: 4, top: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              interval={0}
              className="text-2xs"
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => longLabel(String(value))}
                />
              }
            />
            {series
              .filter((k) => !hidden[k])
              .map((k) => (
                <Bar
                  key={k}
                  dataKey={k}
                  fill={`var(--color-${k})`}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={14}
                />
              ))}
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
