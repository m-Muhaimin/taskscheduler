"use client";

import { useState } from "react";
import { CalendarCheck, RotateCcw } from "lucide-react";

const MESSAGES = [
  {
    from: "ai",
    text: "Sorry we missed your call. This is Ridgeline Plumbing & HVAC. What\u2019s going on?",
    time: "9:47 PM",
  },
  {
    from: "customer",
    text: "Water heater is leaking in the garage. Not an emergency but it\u2019s getting worse.",
    time: "9:48 PM",
  },
  {
    from: "ai",
    text: "Understood. Mike can be there tomorrow between 8 and 10 AM. Does that work?",
    time: "9:48 PM",
  },
  { from: "customer", text: "Yes please", time: "9:49 PM" },
] as const;

export function HeroThread() {
  // Bumping the key remounts the list, which replays the CSS entrance sequence.
  const [run, setRun] = useState(0);

  return (
    <figure aria-labelledby="hero-thread-caption" className="card" style={{ boxShadow: "var(--shadow)" }}>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border">
        <span className="font-mono text-[12.5px]">(206) 555-0142</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11.5px] text-ink-muted">Missed call, 9:47 PM</span>
          <button
            type="button"
            onClick={() => setRun((n) => n + 1)}
            aria-label="Replay conversation"
            title="Replay"
            className="icon-btn icon-btn-ghost w-7 h-7 rounded-[7px]"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      <div key={run}>
        <ol className="flex flex-col gap-3 p-4">
          {MESSAGES.map((m, i) => (
            <li
              key={i}
              className={`thread-msg flex flex-col gap-1 ${m.from === "ai" ? "items-start" : "items-end"}`}
              style={{ "--i": i } as React.CSSProperties}
            >
              <p
                className={`max-w-[88%] px-3 py-2 rounded-[10px] text-[13.5px] leading-[1.5] border ${
                  m.from === "ai" ? "bg-bg border-border" : "bg-surface-2 border-border-strong"
                }`}
              >
                {m.text}
              </p>
              <span className="font-mono text-[10.5px] text-ink-muted">
                {m.from === "ai" ? "Ridgeline AI" : "Customer"} · {m.time}
              </span>
            </li>
          ))}
        </ol>

        <div
          className="thread-msg flex items-start gap-3 px-4 py-3 border-t border-border rounded-b-[10px]"
          style={{ "--i": MESSAGES.length, background: "var(--success-bg)" } as React.CSSProperties}
        >
          <CalendarCheck size={16} className="shrink-0 mt-0.5" style={{ color: "var(--success)" }} aria-hidden="true" />
          <div>
            <p className="chip !p-0 !bg-transparent" style={{ color: "var(--success)" }}>Booked</p>
            <p className="text-[13.5px] font-medium mt-0.5">Water heater repair, Wed 8:00 AM, Mike R.</p>
          </div>
        </div>
      </div>

      <figcaption id="hero-thread-caption" className="sr-only">
        Sample conversation: a missed call becomes a booked water heater repair in four text messages.
      </figcaption>
    </figure>
  );
}
