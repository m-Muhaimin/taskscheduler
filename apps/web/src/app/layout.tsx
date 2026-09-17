import type { Metadata } from "next"
import type { ReactNode } from "react"
import { Toaster } from "sonner"

import { AppSidebar } from "@/components/app-sidebar"
import { BottomNav } from "@/components/bottom-nav"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

export const metadata: Metadata = {
  title: "Solo Sam",
  description: "Daily scheduling for solo tradespeople",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* SidebarMenuButton tooltips (collapsed labels) need a Provider ancestor. */}
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
        </TooltipProvider>
        <BottomNav />
        <Toaster position="bottom-center" offset={90} />
      </body>
    </html>
  )
}