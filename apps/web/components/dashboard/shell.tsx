"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ToastProvider } from "@/components/ui/toast";
import { useEscape } from "@/lib/hooks";
import { NavRail } from "./nav-rail";
import { TopBar } from "./top-bar";

interface ShellState {
  /** Mobile drawer open? (Always false at md+, where the sidebar is permanently visible.) */
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  close: () => void;
}

const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <DashboardShell>");
  return ctx;
}

export const MOBILE_QUERY = "(max-width: 767px)";

export function DashboardShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  // Any navigation closes the drawer.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes it.
  useEscape(close, open);

  // Growing past the breakpoint (rotate / resize) closes it and releases the scroll lock.
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => {
      if (!mq.matches) setOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Lock page scroll behind the open drawer.
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  const value = useMemo(() => ({ open, setOpen, toggle, close }), [open, toggle, close]);

  // `inert` keeps focus and screen readers out of the page while the drawer is open.
  // (React 18 has no typed `inert` prop, hence the spread.)
  const inertProps = (open ? { inert: "" } : {}) as Record<string, string>;

  return (
    <ShellContext.Provider value={value}>
      <ToastProvider>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:px-4 focus:py-2.5 focus:rounded-[10px] focus:bg-surface focus:border focus:border-border-strong"
        >
          Skip to content
        </a>
        <div className="min-h-dvh md:flex">
          <NavRail />
          <div className="flex-1 min-w-0 flex flex-col" {...inertProps}>
            <TopBar />
            <main id="main" className="flex-1 px-5 md:px-8 py-5 md:py-7 max-w-[1400px] w-full mx-auto">
              {children}
            </main>
          </div>
        </div>
      </ToastProvider>
    </ShellContext.Provider>
  );
}
