"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Inbox,
  CalendarDays,
  Briefcase,
  Users,
  BarChart3,
  Settings,
  LogOut,
} from "lucide-react";
import { useSession } from "@/lib/session";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/inbox", label: "AI Inbox", icon: Inbox, badge: 3 },
  { href: "/dashboard/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/dashboard/jobs", label: "Jobs", icon: Briefcase },
  { href: "/dashboard/customers", label: "Customers", icon: Users },
] as const;

const NAV_ITEMS_SECONDARY = [
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
] as const;

function initialsOf(name: string | undefined | null): string {
  if (!name) return "MJ";
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function NavLink({
  href,
  label,
  icon: Icon,
  badge,
  active,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      data-active={active}
      className="nav-item flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-[14px] font-medium text-ink-muted hover:bg-surface-2 hover:text-ink"
    >
      <Icon size={17} className="shrink-0" />
      <span>{label}</span>
      {typeof badge === "number" && (
        <span className="ml-auto text-[10px] font-mono text-ink-muted">{badge}</span>
      )}
    </Link>
  );
}

export function NavRail() {
  const pathname = usePathname();
  const { user, signOut } = useSession();

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border px-4 py-5 bg-surface">
      <Link href="/" aria-label="Ridgeline home" className="flex items-center gap-2.5 px-1 mb-7 rounded-[10px]">
        <div className="w-8 h-8 rounded-[9px] bg-accent text-accent-ink flex items-center justify-center font-head font-bold text-sm">
          R
        </div>
        <div>
          <p className="font-head font-semibold text-[15px] leading-none">Ridgeline</p>
          <p className="text-[11px] text-ink-faint leading-none mt-1">Plumbing &amp; HVAC</p>
        </div>
      </Link>

      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} {...item} active={pathname === item.href} />
        ))}
        <div className="pt-3 mt-2 border-t border-border" />
        {NAV_ITEMS_SECONDARY.map((item) => (
          <NavLink key={item.href} {...item} active={pathname === item.href} />
        ))}
      </nav>

      <div className="mt-auto pt-4 border-t border-border">
        <div className="flex items-center gap-2.5 px-1">
          <div className="w-7 h-7 rounded-full bg-surface-2 border border-border flex items-center justify-center text-[11px] font-mono text-ink-muted">
            {initialsOf(user?.displayName)}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-medium truncate">{user?.displayName ?? "Owner"}</p>
            <p className="text-[11px] text-ink-faint truncate">{user?.email ?? "Plumbing & HVAC"}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="nav-item mt-3 w-full flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-[14px] font-medium text-ink-muted hover:bg-surface-2 hover:text-ink"
        >
          <LogOut size={17} className="shrink-0" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
