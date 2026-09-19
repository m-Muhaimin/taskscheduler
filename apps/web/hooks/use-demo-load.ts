"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

const DEMO_LOAD_MS = 350;

/**
 * Simulated first-paint load for the demo dashboard. Starts unloaded, resolves
 * after ~350ms, or immediately when the user prefers reduced motion — the
 * skeleton-first UX must never add artificial delay for reduced-motion users.
 * The timer is cancelled on unmount and whenever the motion preference flips.
 */
export function useDemoLoad(): boolean {
  const reducedMotion = useReducedMotion();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (reducedMotion) {
      setLoaded(true);
      return;
    }
    const timer = window.setTimeout(() => setLoaded(true), DEMO_LOAD_MS);
    return () => window.clearTimeout(timer);
  }, [reducedMotion]);

  return loaded;
}