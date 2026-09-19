"use client";

import type { ReactNode } from "react";
import { useMockLoad } from "@/lib/hooks";

interface LoadableProps {
  /** What to show while loading. Should mirror the real content's dimensions to avoid layout shift. */
  skeleton: ReactNode;
  children: ReactNode;
  /** Override the simulated latency, e.g. to stagger widgets on one page. */
  delayMs?: number;
  label?: string;
}

/**
 * Shows `skeleton` until the (mock) data is ready, then reveals `children`.
 * Children mount only after loading, so their own entrance animations
 * (count-ups, chart draws, row rises) play as the content appears.
 *
 * Swap point for real data: replace the body with <Suspense fallback={skeleton}>
 * around an async server component, and delete the mock delay in lib/hooks.ts.
 */
export function Loadable({ skeleton, children, delayMs, label = "Loading" }: LoadableProps) {
  const ready = useMockLoad(delayMs);

  if (!ready) {
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">{label}…</span>
        {skeleton}
      </div>
    );
  }
  return <div className="fade-in">{children}</div>;
}
