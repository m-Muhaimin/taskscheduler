"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { useIsomorphicLayoutEffect } from "@/lib/hooks";
import { MOBILE_QUERY, useShell } from "./shell";
import { UserMenu } from "./user-menu";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/inbox", label: "AI Inbox", icon: Inbox, badge: 3 },
  { href: "/dashboard/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/dashboard/jobs", label: "Jobs", icon: Briefcase },
  { href: "/dashboard/customers", label: "Customers", icon: Users },
];

const NAV_ITEMS_SECONDARY: NavItem[] = [
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      data-active={active}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className="nav-item flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-[14px] font-medium text-ink-muted hover:bg-surface-2 hover:text-ink"
    >
      <Icon size={17} className="shrink-0" aria-hidden="true" />
      <span>{item.label}</span>
      {typeof item.badge === "number" && (
        <span
          className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-mono font-medium"
          style={{ background: "var(--danger-bg)", color: "var(--danger)" }}
          aria-label={`${item.badge} need attention`}
        >
          {item.badge}
        </span>
      )}
    </Link>
  );
}

/**
 * Sidebar. At md+ it is pinned to the viewport (one screen tall, never scrolls with the page).
 * Below md it becomes an off-canvas drawer controlled by the top bar's menu button.
 */
export function NavRail() {
  const pathname = usePathname();
  const { open, close } = useShell();
  const navRef = useRef<HTMLElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [pill, setPill] = useState<{ y: number; h: number } | null>(null);
  const [pillReady, setPillReady] = useState(false);

  // Sliding active-item pill: measure the active link and move the pill under it.
  const measure = useCallback(() => {
    const active = navRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    setPill(active ? { y: active.offsetTop, h: active.offsetHeight } : null);
  }, []);
  useIsomorphicLayoutEffect(measure, [pathname, measure]);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    // enable the slide transition only after the first placement, so the pill doesn't fly in from the top
    const raf = requestAnimationFrame(() => setPillReady(true));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [measure]);

  // Focus: into the drawer when it opens, back to the menu button when it closes.
  useEffect(() => {
    if (open) {
      closeBtnRef.current?.focus();
    } else if (wasOpen.current && window.matchMedia(MOBILE_QUERY).matches) {
      document.getElementById("sidebar-toggle")?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  // Swipe left to dismiss.
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (dx < -60 && Math.abs(dx) > Math.abs(dy) * 1.5) close();
  }

  return (
    <>
      <div className="sidebar-backdrop" data-open={open} onClick={close} aria-hidden="true" />

      <aside
        id="dashboard-sidebar"
        className="sidebar"
        data-open={open}
        aria-label="Sidebar"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="flex items-center justify-between gap-2 px-1 mb-6 shrink-0">
          <Logo href="/" subtitle="Plumbing & HVAC" />
          <button
            ref={closeBtnRef}
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="icon-btn icon-btn-ghost md:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <nav
          ref={navRef}
          aria-label="Dashboard"
          className="relative flex flex-col gap-0.5 min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <span
            aria-hidden="true"
            className="nav-pill"
            data-ready={pillReady}
            style={pill ? { transform: `translateY(${pill.y}px)`, height: pill.h, opacity: 1 } : undefined}
          />
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} onNavigate={close} />
          ))}
          <div className="pt-3 mt-2 border-t border-border" role="separator" />
          {NAV_ITEMS_SECONDARY.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} onNavigate={close} />
          ))}
        </nav>

        <div className="shrink-0 pt-3 mt-3 border-t border-border">
          <UserMenu />
        </div>
      </aside>
    </>
  );
}
