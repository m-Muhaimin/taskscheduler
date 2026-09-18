"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CalendarDaysIcon, HomeIcon, SettingsIcon, TriangleAlertIcon, WrenchIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { useDashboardData } from "@/lib/use-dashboard-data"

const navItems = [
  { title: "Today", url: "/dashboard", icon: HomeIcon },
  { title: "Week", url: "/dashboard/week", icon: CalendarDaysIcon },
  { title: "Escalations", url: "/dashboard/escalations", icon: TriangleAlertIcon },
  { title: "Settings", url: "/dashboard/settings", icon: SettingsIcon },
]

function isActive(pathname: string, url: string): boolean {
  // Job detail pages belong to the Today context (they open from Today/Week).
  if (url === "/dashboard") {
    return pathname === "/dashboard" || pathname.startsWith("/dashboard/jobs")
  }
  return pathname.startsWith(url)
}

/** sidebar-07-style collapsible sidebar, desktop only (brief §4.0 / §9 Q7). */
export function AppSidebar() {
  const pathname = usePathname()
  const { user, tradeLabel, escalations, sessionUser } = useDashboardData()
  const pendingEscalations = escalations.filter((e) => e.status === "pending").length

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex h-10 items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <WrenchIcon className="size-4" />
          </div>
          <span className="truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">
            Solo Sam
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Plan</SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild isActive={isActive(pathname, item.url)} tooltip={item.title}>
                  <Link href={item.url}>
                    <item.icon />
                    <span>{item.title}</span>
                    {item.title === "Escalations" && pendingEscalations > 0 && (
                      <Badge
                        variant="urgent-solid"
                        className="ml-auto min-w-4 px-1.5 tabular-nums group-data-[collapsible=icon]:hidden"
                      >
                        {pendingEscalations}
                      </Badge>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex flex-col gap-0.5 px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          <span className="truncate font-medium text-foreground">{tradeLabel}</span>
          <span className="truncate">{sessionUser?.email}</span>
          <span className="tabular-nums">
            {user.businessHours.start}–{user.businessHours.end}
          </span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}