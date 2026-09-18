"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * Today summary strip (brief §5.2, SectionCards pattern):
 * 3 mini-cards — jobs today / unconfirmed / confirmed.
 * The confirmed card counts everything not pending, matching the §4.1 mock
 * ("3 jobs · 1 unconfirmed · 2 confirmed").
 */
export function SummaryStrip({
  loading,
  error,
  total,
  unconfirmed,
  confirmed,
}: {
  loading: boolean
  error?: boolean
  total: number
  unconfirmed: number
  confirmed: number
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    )
  }

  // Error state: values collapse to muted zeros (§5.2 — the Alert lives in the list).
  const cards = [
    { label: "Jobs today", value: error ? 0 : total, urgent: false },
    { label: "Unconfirmed", value: error ? 0 : unconfirmed, urgent: true },
    { label: "Confirmed", value: error ? 0 : confirmed, urgent: false },
  ]

  return (
    <div className="grid grid-cols-3 gap-2">
      {cards.map((c) => (
        <Card
          key={c.label}
          size="sm"
          className={cn(c.urgent && "border-urgent/30 bg-urgent-soft")}
        >
          <CardContent>
            <p
              className={cn(
                "text-xl font-semibold tabular-nums",
                c.urgent && !error ? "text-urgent" : "text-foreground",
                error && "text-muted-foreground"
              )}
            >
              {c.value}
            </p>
            <p className="truncate text-2xs font-medium tracking-wide text-muted-foreground uppercase">{c.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}