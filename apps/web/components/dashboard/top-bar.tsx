"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useToast } from "@/components/ui/toast";
import { useScrolled } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { useShell } from "./shell";

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
  if (!name) return "U";
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
  const { open, toggle } = useShell();
  const toast = useToast();
  const scrolled = useScrolled();
  const { user } = useSession();
  const title = TITLES[pathname] ?? "Dashboard";

  function changeAi(next: boolean) {
    setAiOn(next);
    toast.push(next ? "AI front desk is on" : "AI front desk paused", { tone: next ? "success" : "default" });
  }

  return (
    <header className="topbar" data-scrolled={scrolled}>
      <button
        id="sidebar-toggle"
        type="button"
        onClick={toggle}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="dashboard-sidebar"
        className="icon-btn icon-btn-ghost swap-icon md:hidden -ml-1.5"
        data-on={open}
      >
        <Menu size={19} />
        <X size={19} />
      </button>

      <h1 key={title} className="title-swap min-w-0 font-head font-semibold text-[17px] truncate">
        {title}
      </h1>

      <div className="ml-auto flex items-center gap-2.5 md:gap-3">
        <div className="flex items-center gap-2.5 pr-2.5 md:pr-3 mr-0.5 border-r border-border">
          <span className="flex items-center gap-2 text-[13px] font-medium text-ink-muted">
            <span
              className={aiOn ? "pulse-dot" : "w-1.5 h-1.5 rounded-full bg-ink-faint"}
              style={aiOn ? { color: "var(--success)" } : undefined}
              aria-hidden="true"
            />
            <span className="sm:hidden">AI</span>
            <span className="hidden sm:inline">{aiOn ? "AI front desk on" : "AI front desk paused"}</span>
          </span>
          <Switch on={aiOn} onChange={changeAi} label="AI front desk" />
        </div>

        <ThemeToggle />

        <div
          className="hidden sm:flex w-9 h-9 rounded-full bg-surface-2 border border-border items-center justify-center text-[11px] font-mono text-ink-muted"
          aria-hidden="true"
        >
          {initialsOf(user?.displayName)}
        </div>
      </div>
    </header>
  );
}
