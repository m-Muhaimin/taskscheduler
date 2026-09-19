import Link from "next/link";
import { HeroThread } from "./hero-thread";

export function Hero() {
  return (
    <section className="max-w-[1200px] mx-auto px-6 md:px-12 pt-16 pb-24 lg:pt-24">
      <div className="grid lg:grid-cols-12 gap-12 lg:gap-8 items-center">
        <div className="lg:col-span-7">
          <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-muted mb-6">
            AI front desk for plumbing and HVAC shops
          </p>
          <h1 className="font-head font-semibold text-[clamp(2.5rem,6.2vw,4.75rem)] leading-[1.02] tracking-[-0.035em]">
            You&rsquo;re under a sink. The AI is booking your next job.
          </h1>
          <p className="text-[18px] leading-[1.6] text-ink-muted max-w-[52ch] mt-8">
            Ridgeline texts back every missed call, asks what&rsquo;s wrong, and puts a real appointment on your
            schedule. Emergencies and pricing questions come straight to you.
          </p>
          <div className="flex flex-wrap items-center gap-4 mt-8">
            <Link href="/signup" className="btn btn-primary">
              Create your account
            </Link>
            <Link href="/login" className="btn btn-ghost">
              Sign in
            </Link>
          </div>
        </div>

        <div className="lg:col-span-5">
          <HeroThread />
          <p className="font-mono text-[12px] text-ink-muted mt-4" aria-hidden="true">
            Sample conversation
          </p>
        </div>
      </div>
    </section>
  );
}
