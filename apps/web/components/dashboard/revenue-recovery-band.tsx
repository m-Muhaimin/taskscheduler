import { TrendingUp } from "lucide-react";
import { CountUp } from "@/components/ui/count-up";
import { Sparkline } from "./sparkline";

interface RevenueRecoveryBandProps {
  missedCalls: number;
  recovered: number;
  booked: number;
  estimatedRevenue: number;
  sparkline: number[]; // oldest -> newest
}

export function RevenueRecoveryBand({
  missedCalls,
  recovered,
  booked,
  estimatedRevenue,
  sparkline,
}: RevenueRecoveryBandProps) {
  return (
    <div
      className="mt-7 rounded-[10px] p-5 md:p-6 animate-rise"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
    >
      {/* xl (not md) because the 240px sidebar eats the width between md and xl */}
      <div className="flex flex-col xl:flex-row xl:items-center gap-5 xl:gap-6">
        <div className="xl:w-56 shrink-0">
          <div className="flex items-center gap-1.5 mb-1">
            <h2 className="font-head font-semibold text-[15px]">AI revenue recovery</h2>
            <TrendingUp size={14} style={{ color: "var(--success)" }} aria-hidden="true" />
          </div>
          <p className="text-[12.5px] text-ink-muted leading-relaxed">
            Missed calls the AI turned back into booked jobs this month.
          </p>
        </div>

        <dl className="flex-1 grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_1.6fr] gap-y-4">
          <Stat target={missedCalls} label="missed calls" />
          <Stat target={recovered} label="recovered" />
          <Stat target={booked} label="booked" />
          <Stat target={estimatedRevenue} prefix="~$" label="estimated recovered revenue" accent />
        </dl>

        <div className="w-full xl:w-60 shrink-0">
          <Sparkline
            values={sparkline}
            color="var(--accent)"
            height={72}
            strokeWidth={2}
            suffix=" recovered"
            ringColor="var(--surface-2)"
            ariaLabel="Recovered conversations over the month"
          />
        </div>
      </div>
      <p className="text-[11px] text-ink-faint mt-4 pt-4 border-t border-border">
        Estimate based on average job value for recovered conversations {"\u2014"} not yet confirmed
        against actual payments.
      </p>
    </div>
  );
}

function Stat({
  target,
  label,
  prefix,
  accent,
}: {
  target: number;
  label: string;
  prefix?: string;
  accent?: boolean;
}) {
  return (
    // dt first in the DOM (correct <dl> order), value rendered above it
    <div className="flex flex-col-reverse justify-end gap-1 pr-4 sm:pl-5 sm:border-l sm:border-border sm:first:border-l-0 sm:first:pl-0">
      <dt className="text-[11.5px] text-ink-muted">{label}</dt>
      <dd
        className="font-mono text-[20px] font-medium leading-none"
        style={{ color: accent ? "var(--accent)" : undefined }}
      >
        {prefix}
        <CountUp target={target} durationMs={1100} />
      </dd>
    </div>
  );
}
