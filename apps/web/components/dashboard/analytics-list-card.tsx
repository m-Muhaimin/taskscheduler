import { CountUp } from "@/components/ui/count-up";

export interface RankedRow {
  label: string;
  count: number;
}

interface AnalyticsListCardProps {
  title: string;
  rows: RankedRow[];
  /** Track color: accent (default) / success / danger. */
  tone?: "default" | "success" | "danger";
  delayMs?: number;
  emptyHint?: string;
}

const TRACK_COLOR = {
  default: "var(--accent)",
  success: "var(--success)",
  danger: "var(--danger)",
} as const;

/**
 * Ranked list card (top services / technician load): name + count with a thin
 * share track, styled like the conversation-outcomes rows.
 */
export function AnalyticsListCard({
  title,
  rows,
  tone = "default",
  delayMs = 0,
  emptyHint = "No data yet",
}: AnalyticsListCardProps) {
  const max = rows.length ? rows[0].count : 0;

  return (
    <div className="card p-5 metric-card-rise" style={{ animationDelay: `${delayMs}ms` }}>
      <h3 className="text-[12.5px] font-medium mb-4">{title}</h3>

      {rows.length === 0 ? (
        <div className="flex items-center justify-center h-24 rounded-[6px] border border-dashed border-border">
          <span className="text-[11px] text-ink-faint">{emptyHint}</span>
        </div>
      ) : (
        <ul className="flex flex-col gap-3.5">
          {rows.map((row, i) => (
            <li key={row.label} className="group">
              <div className="flex justify-between gap-3 text-[12.5px] mb-1">
                <span className="truncate">{row.label}</span>
                <span className="font-mono text-ink-muted tabular-nums">
                  <CountUp target={row.count} durationMs={800} />
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full rounded-full origin-left bar-grow-x transition-[filter] duration-200 group-hover:brightness-110"
                  style={{
                    width: `${max ? Math.round((row.count / max) * 100) : 0}%`,
                    background: TRACK_COLOR[tone],
                    animationDelay: `${delayMs + 120 + i * 90}ms`,
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