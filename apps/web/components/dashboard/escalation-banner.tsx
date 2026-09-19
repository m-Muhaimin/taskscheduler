"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, X } from "lucide-react";

export function EscalationBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [gone, setGone] = useState(false);
  const timer = useRef<number>();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function dismiss() {
    setDismissed(true);
    // unmount once the collapse animation has finished
    timer.current = window.setTimeout(() => setGone(true), 320);
  }

  if (gone) return null;

  return (
    <div className="expandable" data-collapsed={dismissed} data-fade="true">
      <div className="expandable-inner">
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 md:px-8 py-2.5 border-b border-border"
          style={{ background: "var(--danger-bg)" }}
          role="alert"
        >
          <AlertTriangle size={15} className="shrink-0" style={{ color: "var(--danger)" }} aria-hidden="true" />
          <p className="flex-1 min-w-[180px] text-[13px] leading-snug" style={{ color: "var(--danger)" }}>
            <span className="font-semibold">Possible emergency{"\u2014"}</span> John Whitfield mentioned water
            coming through a ceiling. AI paused the conversation automatically.
          </p>
          <Link href="/dashboard/inbox" className="btn btn-danger btn-sm shrink-0 order-3 w-full sm:order-none sm:w-auto">
            Take over
          </Link>
          <button
            type="button"
            aria-label="Dismiss alert"
            onClick={dismiss}
            className="order-2 sm:order-none w-7 h-7 rounded-[8px] flex items-center justify-center shrink-0 transition-colors hover:bg-black/5"
            style={{ color: "var(--danger)" }}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
