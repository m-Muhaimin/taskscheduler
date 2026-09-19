import Link from "next/link";

export function FinalCta() {
  return (
    <section className="band" aria-labelledby="cta-heading">
      <div className="max-w-[1200px] mx-auto px-6 md:px-12 py-16 md:py-20 grid lg:grid-cols-12 gap-12 lg:gap-8 lg:items-end">
        <h2
          id="cta-heading"
          className="lg:col-span-8 font-head font-semibold text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.04] tracking-[-0.03em]"
        >
          The phone will ring while you&rsquo;re on a job. Have something answer it.
        </h2>
        <div className="lg:col-span-4 flex flex-wrap items-center gap-6 lg:justify-end">
          <Link href="/signup" className="btn btn-on-band">
            Create your account
          </Link>
          <Link
            href="/login"
            className="text-[15px] font-medium underline underline-offset-4 decoration-1 hover:decoration-2"
            style={{ color: "var(--band-ink)" }}
          >
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}
