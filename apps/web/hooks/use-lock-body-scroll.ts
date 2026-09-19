"use client";

import { useEffect } from "react";

/**
 * Locks body scrolling while `locked` is true, and restores the exact
 * overflow value that was in place before locking. Restores on unlock and
 * on unmount. Intended for modals/drawers with an overlay.
 */
export function useLockBodyScroll(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previous;
    };
  }, [locked]);
}