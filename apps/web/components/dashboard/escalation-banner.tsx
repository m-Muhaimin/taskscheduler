"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, X } from "lucide-react";

export function EscalationBanner() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;

  return (
    <div
      className="flex items-center gap-3 px-5 md:px-8 py-2.5 border-b border-border"
      style={{ background: "var(--danger-bg)" }}
    >
      <AlertTriangle size={15} className="shrink-0" style={{ color: "var(--danger)" }} />
      <p className="text-[13px]" style={{ color: "var(--danger)" }}>
        <span className="font-semibold">Possible emergency{"\u2014"}</span> John Whitfield mentioned
        water coming through a ceiling. AI paused the conversation automatically.
      </p>
      <Link
        href="/dashboard/inbox"
        className="ml-auto shrink-0 text-[13px] font-medium px-3 py-1.5 rounded-[8px] text-white"
        style={{ background: "var(--danger)" }}
      >
        Take over
      </Link>
      <button
        aria-label="Dismiss"
        onClick={() => setVisible(false)}
        className="w-6 h-6 flex items-center justify-center text-ink-faint hover:text-ink shrink-0"
      >
        <X size={13} />
      </button>
    </div>
  );
}
