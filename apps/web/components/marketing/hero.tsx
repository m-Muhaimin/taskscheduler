import Link from "next/link";
import { HeroThread } from "./hero-thread";

export function Hero() {
  return (
    <section className="container-x pt-10 pb-12 md:pt-14 md:pb-16" aria-labelledby="hero-heading">
      <div className="grid lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        <div className="lg:col-span-7">
          <p className="eyebrow mb-4">AI front desk for plumbing and HVAC shops</p>
          <h1 id="hero-heading" className="h-display">
            You&rsquo;re under a sink. The AI is booking your next job.
          </h1>
          <p className="lede mt-5">
            Ridgeline texts back every missed call, asks what&rsquo;s wrong, and puts a real appointment on your
            schedule. Emergencies and pricing questions come straight to you.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-6">
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
          <p className="font-mono text-[11.5px] text-ink-muted mt-3" aria-hidden="true">
            Sample conversation
          </p>
        </div>
      </div>
    </section>
  );
}
