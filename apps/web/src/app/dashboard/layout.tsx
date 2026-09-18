import type { ReactNode } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { BottomNav } from "@/components/bottom-nav"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

/** Dashboard shell: desktop sidebar + mobile bottom nav + sticky header.
 *  Moved out of the root layout so auth pages render standalone. */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={0}>
      <SidebarProvider defaultOpen>
        {/* Sidebar is desktop-only (lg+); mobile uses the bottom nav. */}
        <div className="hidden lg:block">
          <AppSidebar />
        </div>
        <SidebarInset>
          <SiteHeader />
          <div className="mx-auto w-full max-w-xl flex-1 px-4 pt-4 pb-[calc(4rem+env(safe-area-inset-bottom)+1rem)] lg:max-w-5xl lg:px-6 lg:pb-10">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
      <BottomNav />
    </TooltipProvider>
  )
}
