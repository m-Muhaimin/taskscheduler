"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useLockBodyScroll } from "@/hooks/use-lock-body-scroll";

const FOCUSABLE_SELECTOR = 'a[href], button, input, [tabindex]:not([tabindex="-1"])';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}

/**
 * Left slide-over drawer with overlay, used for the mobile dashboard nav.
 *
 * A11y contract (locked in docs/tasks/v2/ridgeline-ui-polish.md #5):
 * - role="dialog" + aria-modal + aria-label on the panel
 * - ESC / overlay click / close button all dismiss
 * - focus moves into the panel on open and returns to the trigger on close
 * - Tab/Shift+Tab is trapped inside the panel
 * - body scroll is locked while open
 * - reduced motion: panel renders in place, no slide, no fade
 *
 * The drawer unmounts immediately on close (no exit animation) - deliberate,
 * documented choice so closing never feels laggy and focus restoration is trivial.
 */
export function Drawer({ open, onClose, label, children }: DrawerProps) {
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [entered, setEntered] = useState(false);

  // Body scroll lock while the drawer is open (T1 hook).
  useLockBodyScroll(open);

  // Enter animation: panel slides in from the left, overlay fades in.
  // The off-state is applied on the frame the drawer mounts, then flipped one
  // frame later so the CSS transition actually runs. Skipped entirely under
  // reduced motion (no transform, no animation).
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
    setEntered(false);
  }, [open]);

  // Save the trigger, move focus into the panel on open, restore on close.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open]);

  // ESC dismisses from anywhere while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Simple focus trap: cycle Tab/Shift+Tab among the panel's focusables.
  const handlePanelKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) =>
        !el.hasAttribute("disabled") &&
        el.getAttribute("aria-hidden") !== "true" &&
        !el.closest('[aria-hidden="true"]')
    );
    const active = document.activeElement as HTMLElement | null;

    // Hardening: if focus has escaped the panel (overlay click, programmatic
    // focus loss), pull it back in on the next Tab press.
    const focusWithinPanel = active !== null && (active === panel || panel.contains(active));
    if (!focusWithinPanel) {
      event.preventDefault();
      (focusables[0] ?? panel).focus();
      return;
    }

    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey) {
      if (active === first || active === panel) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  if (!open) return null;

  const animate = !reducedMotion;
  const shown = !animate || entered;

  return (
    <div className="fixed inset-0 z-40">
      {/* Overlay: click-to-dismiss backdrop, hidden from the accessibility tree.
          tabIndex={-1} keeps it out of the tab order entirely (a focusable
          element with aria-hidden would be an a11y violation). */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 ${
          animate ? "transition-opacity duration-[260ms]" : ""
        } ${shown ? "opacity-100" : "opacity-0"}`}
      />
      <div
        ref={panelRef}
        id="mobile-nav"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
        className={`relative flex h-full w-[280px] max-w-[85vw] flex-col border-r border-border bg-surface px-4 py-5 shadow-xl outline-none ${
          animate
            ? `transition-transform duration-[260ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${
                shown ? "translate-x-0" : "-translate-x-full"
              }`
            : ""
        }`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-[10px] text-ink-muted transition-colors duration-[160ms] hover:bg-surface-2 hover:text-ink"
        >
          <X size={17} />
        </button>
        {children}
      </div>
    </div>
  );
}