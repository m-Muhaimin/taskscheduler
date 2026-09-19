import { revenueRecovery } from "@/lib/fixtures";

const FIGURES: { value: string; label: string; accent?: boolean }[] = [
  { value: String(revenueRecovery.missedCalls), label: "missed calls" },
  { value: String(revenueRecovery.recovered), label: "got a text back" },
  { value: String(revenueRecovery.booked), label: "turned into booked jobs" },
  { value: `$${revenueRecovery.estimatedRevenue.toLocaleString("en-US")}`, label: "in estimated revenue", accent: true },
];

export function ResultsBand() {
  return (
    <section className="band" aria-labelledby="results-heading">
      <div className="max-w-[1200px] mx-auto px-6 md:px-12 py-16 md:py-20">
        <div className="grid lg:grid-cols-12 gap-8 lg:gap-12 lg:items-end mb-12">
          <div className="lg:col-span-7">
            <p className="font-mono text-[12px] uppercase tracking-[0.12em] mb-4" style={{ color: "var(--band-muted)" }}>
              Sample month, from the dashboard
            </p>
            <h2
              id="results-heading"
              className="font-head font-semibold text-[clamp(1.875rem,3.6vw,2.75rem)] leading-[1.08] tracking-[-0.02em]"
            >
              Calls that used to go to voicemail, counted.
            </h2>
          </div>
          <p className="lg:col-span-5 text-[16px] leading-[1.6]" style={{ color: "var(--band-muted)" }}>
            Every missed call is logged, answered, and followed to an outcome, so you can see what the front desk
            recovered instead of guessing.
          </p>
        </div>

        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-12">
          {FIGURES.map((f) => (
            <div key={f.label} className="border-t border-band-rule pt-4 flex flex-col-reverse gap-3">
              <dt className="text-[15px]" style={{ color: "var(--band-muted)" }}>
                {f.label}
              </dt>
              <dd
                className="font-head font-semibold text-[clamp(2.5rem,5vw,4rem)] leading-none tracking-[-0.03em] tabular-nums"
                style={f.accent ? { color: "var(--band-accent)" } : undefined}
              >
                {f.value}
              </dd>
            </div>
          ))}
        </dl>

        <p className="font-mono text-[12px] mt-12" style={{ color: "var(--band-muted)" }}>
          Sample data from the demo dashboard. Revenue is an estimate.
        </p>
      </div>
    </section>
  );
}
