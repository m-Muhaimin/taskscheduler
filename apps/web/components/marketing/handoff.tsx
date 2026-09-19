import { AlertTriangle } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { SectionHeading } from "./section-heading";

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
      <div className="container-x section">
        <div className="grid lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          <div className="lg:col-span-6 order-2 lg:order-1 reveal">
            {/* Mirrors the real dashboard banner + inbox rows (same tokens, chips and left bars) */}
            <div
              className="card overflow-hidden"
              style={{ background: "var(--bg)" }}
              role="img"
              aria-label="Example dashboard alert: possible emergency flagged, AI paused, Take over button, and a pricing question waiting for the owner."
            >
              <div className="flex items-center gap-3 px-4 py-2.5" style={{ background: "var(--danger-bg)" }}>
                <AlertTriangle size={15} className="shrink-0" style={{ color: "var(--danger)" }} aria-hidden="true" />
                <p className="text-[13px] leading-snug" style={{ color: "var(--danger)" }}>
                  <span className="font-semibold">Possible emergency.</span> John Whitfield mentioned water coming
                  through a ceiling. AI paused the conversation.
                </p>
                <span className="btn btn-danger btn-sm ml-auto shrink-0 !min-h-[30px]" aria-hidden="true">
                  Take over
                </span>
              </div>
              <ul className="divided">
                {ROWS.map((r) => (
                  <li key={r.name} className="px-4 py-3" style={{ borderLeft: "2.5px solid var(--danger)" }}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13.5px] font-medium">{r.name}</p>
                      <Chip tone="danger">Needs attention</Chip>
                      <span className="font-mono text-[11px] text-ink-faint ml-auto">SMS · {r.time}</span>
                    </div>
                    <p className="text-[12.5px] text-ink-muted mt-0.5">{r.message}</p>
                    <p className="text-[12px] mt-1" style={{ color: "var(--danger)" }}>
                      {r.note}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="lg:col-span-5 lg:col-start-8 order-1 lg:order-2">
            <SectionHeading
              id="handoff-heading"
              eyebrow="Emergencies and edge cases"
              title="It stops when a person should take over."
            >
              <p>Water through a ceiling is not a chat, and a price the AI doesn&rsquo;t know is not a guess.</p>
              <p>
                In both cases it pauses the conversation, flags it at the top of your dashboard, and gives you a Take
                over button.
              </p>
            </SectionHeading>
          </div>
        </div>
      </div>
    </section>
  );
}
