import { CountUp } from "@/components/ui/count-up";

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
  const total = data.reduce((sum, v) => sum + v, 0);
  return (
    <div className="card p-5 metric-card-rise">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h3 className="text-[12.5px] font-medium">Inbound demand by hour</h3>
        <p className="font-mono text-[11px] text-ink-muted">
          <CountUp target={total} /> total · peak {max}
        </p>
      </div>
      {max === 0 ? (
        <div className="flex items-center justify-center h-28 rounded-[6px] border border-dashed border-border">
          <span className="text-[11px] text-ink-faint">No demand recorded yet</span>
        </div>
      ) : (
        <div
          className="bars flex items-end gap-1.5 h-28"
          role="img"
          aria-label={`Bar chart of inbound inquiries by hour. Peak is ${max}, ${total} in total.`}
        >
          {data.map((v, i) => {
            const h = Math.round((v / max) * 100);
            return (
              <div key={i} className="bar-wrap relative flex-1 h-full flex items-end">
                <div
                  className="bar bar-grow w-full rounded-t-[3px]"
                  style={
                    {
                      height: `${h}%`,
                      background: "var(--accent)",
                      "--o": 0.35 + (h / 100) * 0.65,
                      animationDelay: `${i * 35}ms`,
                    } as React.CSSProperties
                  }
                />
                <div
                  className="bar-tooltip absolute left-1/2 px-1.5 py-0.5 rounded-[5px] text-[10px] font-mono bg-surface border border-border-strong whitespace-nowrap z-10"
                  style={{ bottom: `calc(${h}% + 6px)` }}
                >
                  {v} inquiries
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ConversationOutcomesChart({ outcomes }: { outcomes: Outcome[] }) {
  return (
    <div className="card p-5 metric-card-rise" style={{ animationDelay: "80ms" }}>
      <h3 className="text-[12.5px] font-medium mb-4">Conversation outcomes</h3>
      {outcomes.length === 0 ? (
        <div className="flex items-center justify-center h-24 rounded-[6px] border border-dashed border-border">
          <span className="text-[11px] text-ink-faint">No conversations yet</span>
        </div>
      ) : (
        <ul className="flex flex-col gap-3.5 mt-1">
          {outcomes.map((o, i) => (
            <li key={o.label} className="group">
              <div className="flex justify-between text-[12px] mb-1">
                <span>{o.label}</span>
                <span className="font-mono text-ink-muted transition-colors group-hover:text-ink">
                  <CountUp target={o.pct} durationMs={1000} />%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full rounded-full origin-left bar-grow-x transition-[filter] duration-200 group-hover:brightness-110"
                  style={{
                    width: `${o.pct}%`,
                    background: TONE_COLOR[o.tone],
                    animationDelay: `${150 + i * 120}ms`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
