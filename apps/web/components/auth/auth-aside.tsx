const OVERNIGHT = [
  {
    time: "9:47 PM",
    event: "Missed call, texted back",
    result: "Water heater leak. Booked Wed 8:00 AM with Mike.",
    tone: "success",
  },
  {
    time: "11:12 PM",
    event: "Text inquiry",
    result: "AC rattling, not urgent. Booked Thu 2:00 PM.",
    tone: "success",
  },
  {
    time: "2:07 AM",
    event: "Text inquiry",
    result: "Water through a ceiling. AI paused and flagged for you.",
    tone: "danger",
  },
] as const;

export function AuthAside({ heading }: { heading: string }) {
  return (
    <aside
      aria-label="Example overnight activity"
      className="hidden lg:flex flex-col justify-center border-l border-border px-10 xl:px-14 py-10"
    >
      <div className="max-w-[440px]">
        <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-muted">Sample overnight log</p>
        <p className="font-head font-semibold text-[28px] leading-[1.1] tracking-[-0.02em] mt-3 mb-8">{heading}</p>

        <ol className="border-t border-border-strong">
          {OVERNIGHT.map((row) => (
            <li key={row.time} className="grid grid-cols-[72px_1fr] gap-4 py-4 border-b border-border-strong">
              <span className="font-mono text-[13px] text-ink-muted pt-1">{row.time}</span>
              <div>
                <p className="text-[14px] font-medium">{row.event}</p>
                <p className="text-[14px] leading-[1.5] mt-1 flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-2 w-2 h-2 rounded-full shrink-0"
                    style={{ background: row.tone === "danger" ? "var(--danger)" : "var(--success)" }}
                  />
                  <span>{row.result}</span>
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
