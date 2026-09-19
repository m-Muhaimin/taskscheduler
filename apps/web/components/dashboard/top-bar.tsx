"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { AiSwitch } from "./ai-switch";
import { ThemeToggle } from "./theme-toggle";
import { useSession } from "@/lib/session";

const TITLES: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/inbox": "AI Inbox",
  "/dashboard/schedule": "Schedule",
  "/dashboard/jobs": "Jobs",
  "/dashboard/customers": "Customers",
  "/dashboard/analytics": "Analytics",
  "/dashboard/settings": "Settings",
};

function initialsOf(name: string | undefined | null): string {
  if (!name) return "MJ";
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function TopBar() {
  const [aiOn, setAiOn] = useState(true);
  const pathname = usePathname();
  const { user } = useSession();
  const title = TITLES[pathname] ?? "Dashboard";

  return (
    <header className="flex items-center gap-4 px-5 md:px-8 py-4 border-b border-border bg-surface sticky top-0 z-10">
      <button className="md:hidden p-2 -ml-2" aria-label="Menu">
        <Menu size={19} />
      </button>

      <h1 className="font-head font-semibold text-lg hidden sm:block">{title}</h1>

      <div className="ml-auto flex items-center gap-2.5 md:gap-4">
        <div className="hidden sm:flex items-center gap-2.5 pr-3 mr-1 border-r border-border">
          <span className="text-[13px] font-medium text-ink-muted">
            {aiOn ? "AI front desk on" : "AI front desk paused"}
          </span>
          <AiSwitch on={aiOn} onChange={setAiOn} label="Toggle AI front desk" />
        </div>

        <ThemeToggle />

        <div className="w-9 h-9 rounded-full bg-surface-2 border border-border flex items-center justify-center text-[11px] font-mono text-ink-muted">
          {initialsOf(user?.displayName)}
        </div>
      </div>
    </header>
  );
}
