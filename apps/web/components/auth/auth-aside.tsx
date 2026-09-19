import { Chip, type ChipTone } from "@/components/ui/chip";

const OVERNIGHT: { time: string; event: string; result: string; chip: string; tone: ChipTone }[] = [
  {
    time: "9:47 PM",
    event: "Missed call, texted back",
    result: "Water heater leak. Booked Wed 8:00 AM with Mike.",
    chip: "Booked",
    tone: "success",
  },
  {
    time: "11:12 PM",
    event: "Text inquiry",
    result: "AC rattling, not urgent. Booked Thu 2:00 PM.",
    chip: "Booked",
    tone: "success",
  },
  {
    time: "2:07 AM",
    event: "Text inquiry",
    result: "Water through a ceiling. AI paused and flagged for you.",
    chip: "Flagged",
    tone: "danger",
  },
];

const BAR: Record<ChipTone, string> = {
  success: "var(--success)",
  danger: "var(--danger)",
  muted: "var(--border-strong)",
};

/** Sample log rendered with the same row anatomy as the dashboard AI Inbox (left bar, chip, muted copy). */
export function AuthAside({ heading }: { heading: string }) {
  return (
    <aside
      aria-label="Example overnight activity"
      className="hidden lg:flex flex-col justify-center border-l border-border px-10 xl:px-16 py-10"
    >
      <div className="w-full max-w-[420px]">
        <p className="eyebrow">Sample overnight log</p>
        <p className="font-head font-semibold text-[22px] xl:text-[24px] leading-[1.15] tracking-[-0.02em] mt-2 mb-5">
          {heading}
        </p>

        <ol className="card overflow-hidden divided">
          {OVERNIGHT.map((row, i) => (
            <li
              key={row.time}
              className="metric-card-rise px-4 py-3"
              style={{ borderLeft: `2.5px solid ${BAR[row.tone]}`, animationDelay: `${250 + i * 120}ms` }}
            >
              <div className="flex items-center gap-2">
                <p className="text-[13.5px] font-medium">{row.event}</p>
                <Chip tone={row.tone}>{row.chip}</Chip>
                <span className="font-mono text-[11px] text-ink-faint ml-auto">{row.time}</span>
              </div>
              <p className="text-[12.5px] leading-[1.5] text-ink-muted mt-1">{row.result}</p>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
