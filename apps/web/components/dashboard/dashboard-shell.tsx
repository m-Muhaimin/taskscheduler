"use client";

import { useState, type ReactNode } from "react";
import { DesktopSidebar, MobileSidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { EscalationBanner } from "./escalation-banner";

/** Client shell owning the mobile nav drawer state. */
export function DashboardShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen flex">
      <DesktopSidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar onMenu={() => setMenuOpen(true)} menuOpen={menuOpen} />
        <EscalationBanner />
        <main className="flex-1 px-5 md:px-8 py-6 md:py-7 max-w-[1400px] w-full mx-auto animate-rise">
          {children}
        </main>
      </div>
      <MobileSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}