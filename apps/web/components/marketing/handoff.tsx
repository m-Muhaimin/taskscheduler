import { AlertTriangle } from "lucide-react";
import { Eyebrow } from "@/components/ui/eyebrow";

const ROWS = [
  {
    name: "John Whitfield",
    time: "2m ago",
    message: "\u201cThere\u2019s water pouring through the ceiling right now.\u201d",
    note: "AI paused. Flagged as possible emergency.",
  },
  {
    name: "Dale Torres",
    time: "22m ago",
    message: "\u201cIs the $89 diagnostic fee separate from repair cost?\u201d",
    note: "AI unsure how to answer a pricing question. Needs your input.",
  },
] as const;

export function Handoff() {
  return (
    <section id="handoff" className="bg-surface border-y border-border" aria-labelledby="handoff-heading">
      <div className="max-w-[1200px] mx-auto px-6 md:px-12 py-16 md:py-20">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          <div className="lg:col-span-6 order-2 lg:order-1 reveal">
            <div
              className="border border-border-strong rounded-[10px] overflow-hidden"
              style={{ background: "var(--bg)" }}
              role="img"
              aria-label="Example dashboard alert: possible emergency flagged, AI paused, Take over button, and a pricing question waiting for the owner."
            >
              <div className="flex items-center gap-3 px-4 py-3" style={{ background: "var(--danger-bg)" }}>
                <AlertTriangle size={16} className="shrink-0" style={{ color: "var(--danger)" }} aria-hidden="true" />
                <p className="text-[13px] leading-snug" style={{ color: "var(--danger)" }}>
                  <span className="font-semibold">Possible emergency.</span> John Whitfield mentioned water coming
                  through a ceiling. AI paused the conversation.
                </p>
                <span
                  className="ml-auto shrink-0 text-[13px] font-medium px-3 py-2 rounded-[10px]"
                  style={{ background: "var(--danger)", color: "var(--danger-bg)" }}
                >
                  Take over
                </span>
              </div>
              <ul>
                {ROWS.map((r) => (
                  <li key={r.name} className="px-4 py-4 border-t border-border-strong first:border-t-0">
                    <div className="flex items-baseline justify-between gap-4">
                      <p className="text-[14px] font-medium">{r.name}</p>
                      <p className="font-mono text-[11px] text-ink-muted">SMS · {r.time}</p>
                    </div>
                    <p className="text-[14px] leading-[1.5] mt-1">{r.message}</p>
                    <p className="text-[13px] leading-[1.5] mt-2" style={{ color: "var(--danger)" }}>
                      {r.note}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="lg:col-span-5 lg:col-start-8 order-1 lg:order-2">
            <Eyebrow className="mb-4">Emergencies and edge cases</Eyebrow>
            <h2
              id="handoff-heading"
              className="font-head font-semibold text-[clamp(1.875rem,3.6vw,2.75rem)] leading-[1.08] tracking-[-0.02em]"
            >
              It stops when a person should take over.
            </h2>
            <p className="text-[17px] leading-[1.6] text-ink-muted mt-6 max-w-[52ch]">
              Water through a ceiling is not a chat, and a price the AI doesn&rsquo;t know is not a guess.
            </p>
            <p className="text-[17px] leading-[1.6] text-ink-muted mt-4 max-w-[52ch]">
              In both cases it pauses the conversation, flags it at the top of your dashboard, and gives you a Take
              over button.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
