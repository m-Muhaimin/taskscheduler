import { CountUp } from "@/components/ui/count-up";
import { revenueRecovery } from "@/lib/fixtures";
import { SectionHeading } from "./section-heading";

const FIGURES: { target: number; prefix?: string; label: string; accent?: boolean }[] = [
  { target: revenueRecovery.missedCalls, label: "missed calls" },
  { target: revenueRecovery.recovered, label: "got a text back" },
  { target: revenueRecovery.booked, label: "turned into booked jobs" },
  { target: revenueRecovery.estimatedRevenue, prefix: "$", label: "in estimated revenue", accent: true },
];

export function ResultsBand() {
  return (
    <section className="band" aria-labelledby="results-heading">
      <div className="container-x section">
        <div className="grid lg:grid-cols-12 gap-4 lg:gap-12 lg:items-end mb-8">
          <div className="lg:col-span-7">
            <SectionHeading
              id="results-heading"
              tone="band"
              eyebrow="Sample month, from the dashboard"
              title="Calls that used to go to voicemail, counted."
            />
          </div>
          <p className="lg:col-span-5 text-[14.5px] leading-[1.6]" style={{ color: "var(--band-muted)" }}>
            Every missed call is logged, answered, and followed to an outcome, so you can see what the front desk
            recovered instead of guessing.
          </p>
        </div>

        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-8">
          {FIGURES.map((f) => (
            <div key={f.label} className="border-t border-band-rule pt-3 flex flex-col-reverse gap-2">
              <dt className="text-[13.5px]" style={{ color: "var(--band-muted)" }}>
                {f.label}
              </dt>
              <dd
                className="font-head font-semibold text-[clamp(2rem,1.4rem+2.4vw,3rem)] leading-none tracking-[-0.03em]"
                style={f.accent ? { color: "var(--band-accent)" } : undefined}
              >
                {f.prefix}
                <CountUp target={f.target} startOnView durationMs={1200} />
              </dd>
            </div>
          ))}
        </dl>

        <p className="font-mono text-[11.5px] mt-8" style={{ color: "var(--band-muted)" }}>
          Sample data from the demo dashboard. Revenue is an estimate.
        </p>
      </div>
    </section>
  );
}
