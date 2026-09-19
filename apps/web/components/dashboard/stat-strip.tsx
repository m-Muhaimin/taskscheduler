import type { StatItem } from "@/lib/types";
import { CountUp } from "./count-up";

const TONE_COLOR: Record<NonNullable<StatItem["tone"]>, string> = {
  default: "var(--ink)",
  success: "var(--success)",
  danger: "var(--danger)",
};

export function StatStrip({ stats }: { stats: StatItem[] }) {
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-4 pb-7 mb-7 border-b border-border">
      {stats.map((stat) => (
        <div key={stat.id}>
          <p
            className="font-mono text-[28px] font-medium leading-none"
            style={{ color: TONE_COLOR[stat.tone ?? "default"] }}
          >
            {stat.prefix}
            <CountUp target={stat.value} />
            {stat.suffix}
          </p>
          <p className="text-[12px] text-ink-muted mt-1.5">{stat.label}</p>
        </div>
      ))}
    </div>
  );
}
