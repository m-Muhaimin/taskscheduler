"use client"

import { usePathname, useRouter } from "next/navigation"
import { CalendarDaysIcon, HomeIcon, SettingsIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { dayKey } from "@/lib/format"
import { useDashboardData } from "@/lib/use-dashboard-data"

const items = [
  { value: "today", label: "Today", href: "/dashboard", icon: HomeIcon },
  { value: "week", label: "Week", href: "/dashboard/week", icon: CalendarDaysIcon },
  { value: "settings", label: "Settings", href: "/dashboard/settings", icon: SettingsIcon },
]

function valueFor(pathname: string): string {
  if (pathname.startsWith("/dashboard/week")) return "week"
  if (pathname.startsWith("/dashboard/settings")) return "settings"
  return "today"
}

/**
 * Mobile tab bar (brief §4.0): h-16, border-t, safe-area bottom padding,
 * active = primary text + 2px top indicator. `Tabs` for ARIA tab semantics
 * (§5.1). Unconfirmed-count badge on Today at sm+ (§9 Q6 ruling).
 */
export function BottomNav() {
  const pathname = usePathname()
  const router = useRouter()
  const { bookings, businessTz } = useDashboardData()

  const todayKey = dayKey(new Date().toISOString(), businessTz)
  const unconfirmed = bookings.filter(
    (b) => b.status === "pending" && dayKey(b.startTime, businessTz) === todayKey
  ).length

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <Tabs
        value={valueFor(pathname)}
        onValueChange={(v) => {
          const item = items.find((i) => i.value === v)
          if (item) router.push(item.href)
        }}
        className="w-full"
      >
        <TabsList
          variant="line"
          className="grid h-16 w-full grid-cols-3 gap-0 rounded-none bg-transparent p-0"
        >
          {items.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="h-16 flex-col gap-0.5 rounded-none border-t-2 border-transparent px-1 text-xs data-active:border-primary data-active:text-primary"
            >
              <item.icon className="size-5" />
              <span className="flex items-center gap-1">
                {item.label}
                {item.value === "today" && unconfirmed > 0 && (
                  <Badge
                    variant="urgent-solid"
                    aria-label={`${unconfirmed} unconfirmed`}
                    className="hidden min-w-4 px-1.5 text-[10px] font-semibold leading-none sm:inline-flex"
                  >
                    {unconfirmed}
                  </Badge>
                )}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </nav>
  )
}