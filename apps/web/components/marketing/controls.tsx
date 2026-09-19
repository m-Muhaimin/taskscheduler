"use client";

import { useState } from "react";
import { AiSwitch } from "@/components/dashboard/ai-switch";

const ROWS = [
  {
    id: "ai-front-desk",
    title: "AI front desk",
    description: "Answers, qualifies, and books new inquiries without you.",
    defaultOn: true,
  },
  {
    id: "review-requests",
    title: "Auto-send review requests",
    description: "Texts a review link when a job is marked complete.",
    defaultOn: true,
  },
  {
    id: "deposit-required",
    title: "Deposit required for new bookings",
    description: "Asks first-time customers for a $50 deposit before confirming.",
    defaultOn: false,
  },
] as const;

export function Controls() {
  const [state, setState] = useState<Record<string, boolean>>(
    Object.fromEntries(ROWS.map((r) => [r.id, r.defaultOn]))
  );

  return (
    <section className="max-w-[1200px] mx-auto px-6 md:px-12 py-24" aria-labelledby="controls-heading">
      <div className="max-w-[720px]">
        <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-muted mb-4">Your rules</p>
        <h2
          id="controls-heading"
          className="font-head font-semibold text-[clamp(1.875rem,3.6vw,2.75rem)] leading-[1.08] tracking-[-0.02em]"
        >
          You set the rules. The AI follows them.
        </h2>
        <p className="text-[17px] leading-[1.6] text-ink-muted mt-6 max-w-[52ch]">
          Every behavior that touches a customer has a switch. Try these. Nothing here is saved.
        </p>

        <ul className="mt-12 border-t border-border-strong">
          {ROWS.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-6 py-6 border-b border-border-strong">
              <div>
                <p className="text-[16px] font-medium">{row.title}</p>
                <p className="text-[15px] leading-[1.5] text-ink-muted mt-1">{row.description}</p>
              </div>
              <AiSwitch
                on={state[row.id]}
                onChange={(next) => setState((s) => ({ ...s, [row.id]: next }))}
                label={row.title}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
