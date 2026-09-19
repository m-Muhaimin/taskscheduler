interface Outcome {
  label: string;
  pct: number;
  tone: "success" | "danger" | "muted";
}

const TONE_COLOR: Record<Outcome["tone"], string> = {
  success: "var(--success)",
  danger: "var(--danger)",
  muted: "var(--ink-faint)",
};

export function DemandByHourChart({ data }: { data: number[] }) {
  const max = Math.max(...data);
  return (
    <div className="border border-border rounded-[10px] bg-surface p-5 metric-card-rise">
      <p className="text-[12.5px] font-medium mb-4">Inbound demand by hour</p>
      <div className="flex items-end gap-1.5 h-28">
        {data.map((v, i) => {
          const h = Math.round((v / max) * 100);
          return (
            <div key={i} className="bar-wrap relative flex-1 h-full flex items-end">
              <div
                className="bar-grow w-full rounded-t-[3px]"
                style={{
                  height: `${h}%`,
                  background: "var(--accent)",
                  opacity: 0.35 + (h / 100) * 0.65,
                  animationDelay: `${i * 35}ms`,
                }}
              />
              <div
                className="bar-tooltip absolute left-1/2 px-1.5 py-0.5 rounded-[5px] text-[10px] font-mono bg-surface border border-border-strong whitespace-nowrap"
                style={{ bottom: `calc(${h}% + 6px)` }}
              >
                {v} inquiries
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ConversationOutcomesChart({ outcomes }: { outcomes: Outcome[] }) {
  return (
    <div className="border border-border rounded-[10px] bg-surface p-5 metric-card-rise" style={{ animationDelay: "80ms" }}>
      <p className="text-[12.5px] font-medium mb-4">Conversation outcomes</p>
      <div className="flex flex-col gap-3.5 mt-1">
        {outcomes.map((o, i) => (
          <div key={o.label}>
            <div className="flex justify-between text-[12px] mb-1">
              <span>{o.label}</span>
              <span className="font-mono text-ink-muted">{o.pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
              <div
                className="h-full rounded-full origin-left bar-grow-x"
                style={{
                  width: `${o.pct}%`,
                  background: TONE_COLOR[o.tone],
                  animationDelay: `${150 + i * 120}ms`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
