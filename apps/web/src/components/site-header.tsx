"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { deviceTimezone, formatDateLabel, tzAbbr } from "@/lib/format"
import { useDashboardData } from "@/lib/use-dashboard-data"

function titleFor(pathname: string): string {
  if (pathname.startsWith("/dashboard/escalations")) return "Escalations"
  if (pathname.startsWith("/dashboard/jobs")) return "Job details"
  if (pathname.startsWith("/dashboard/week")) return "Week"
  if (pathname.startsWith("/dashboard/settings")) return "Settings"
  return "Today"
}

/** dashboard-01 SiteHeader pattern, trimmed: page title + date (+ tz label). */
export function SiteHeader() {
  const pathname = usePathname()
  const { businessTz, loadState } = useDashboardData()
  const [showTz, setShowTz] = useState(false)

  // Q8 ruling: label the business timezone only when it differs from device tz.
  useEffect(() => {
    setShowTz(deviceTimezone() !== businessTz)
  }, [businessTz])

  return (
    <header className="sticky top-0 z-20 flex h-(--header-height) shrink-0 items-center border-b bg-background">
      <div className="flex w-full items-center gap-2 px-4 lg:px-5">
        <SidebarTrigger className="-ml-1.5 hidden lg:inline-flex" />
        <h1 className="text-base font-semibold">{titleFor(pathname)}</h1>
        {/* Date is client-only (fixture data lives client-side after SSR). */}
        {loadState === "ready" && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {formatDateLabel(new Date().toISOString(), businessTz)}
            {showTz && <span className="hidden sm:inline"> · {tzAbbr(businessTz)}</span>}
          </span>
        )}
      </div>
    </header>
  )
}