import { CalendarCheck } from "lucide-react";

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
  return (
    <figure
      aria-labelledby="hero-thread-caption"
      className="border border-border-strong rounded-[10px] bg-surface"
      style={{ boxShadow: "var(--shadow)" }}
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border">
        <span className="font-mono text-[13px]">(206) 555-0142</span>
        <span className="font-mono text-[12px] text-ink-muted">Missed call, 9:47 PM</span>
      </div>

      <ol className="flex flex-col gap-4 p-4 md:p-6">
        {MESSAGES.map((m, i) => (
          <li
            key={i}
            className={`thread-msg flex flex-col gap-1 ${m.from === "ai" ? "items-start" : "items-end"}`}
            style={{ "--i": i } as React.CSSProperties}
          >
            <p
              className={`max-w-[88%] px-4 py-3 rounded-[10px] text-[15px] leading-[1.5] border ${
                m.from === "ai" ? "bg-bg border-border" : "bg-surface-2 border-border-strong"
              }`}
            >
              {m.text}
            </p>
            <span className="font-mono text-[11px] text-ink-muted">
              {m.from === "ai" ? "Ridgeline AI" : "Customer"} · {m.time}
            </span>
          </li>
        ))}
      </ol>

      <div
        className="thread-msg flex items-start gap-3 px-4 md:px-6 py-4 border-t border-border rounded-b-[10px]"
        style={{ "--i": MESSAGES.length, background: "var(--success-bg)" } as React.CSSProperties}
      >
        <CalendarCheck size={18} className="shrink-0 mt-1" style={{ color: "var(--success)" }} aria-hidden="true" />
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink">Booked</p>
          <p className="text-[15px] font-medium mt-1">Water heater repair, Wed 8:00 AM, Mike R.</p>
        </div>
      </div>

      <figcaption id="hero-thread-caption" className="sr-only">
        Sample conversation: a missed call becomes a booked water heater repair in four text messages.
      </figcaption>
    </figure>
  );
}
