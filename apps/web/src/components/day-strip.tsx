"use client"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

export type DayChip = {
  key: string
  iso: string
  weekday: string
  dayNum: string
  isToday: boolean
}

/**
 * Week day picker, mobile (brief §5.6): sticky under the header, one chip per
 * day, today always primary-filled, the selected day ring-marked.
 */
export function DayStrip({
  days,
  value,
  onValueChange,
}: {
  days: DayChip[]
  value: string
  onValueChange: (value: string) => void
}) {
  return (
    <div className="sticky top-(--header-height) z-10 -mx-4 border-b bg-background lg:-mx-5">
      <Tabs value={value} onValueChange={onValueChange} className="w-full">
        <TabsList
          variant="line"
          className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-2"
        >
          {days.map((d) => (
            <TabsTrigger
              key={d.key}
              value={d.key}
              aria-label={`${d.weekday} ${d.dayNum}`}
              className={cn(
                "h-12 min-w-12 flex-1 flex-col gap-0.5 rounded-md px-1",
                d.isToday &&
                  "bg-primary text-primary-foreground data-active:bg-primary data-active:text-primary-foreground data-active:ring-2 data-active:ring-ring data-active:ring-offset-1"
              )}
            >
              <span className="text-2xs font-medium tracking-wide uppercase opacity-80">{d.weekday}</span>
              <span className="text-xs font-semibold tabular-nums">{d.dayNum}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}