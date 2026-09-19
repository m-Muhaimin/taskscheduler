import Link from "next/link";

export function FinalCta() {
  return (
    <section className="band" aria-labelledby="cta-heading">
      <div className="container-x section grid lg:grid-cols-12 gap-6 lg:gap-8 lg:items-end">
        <h2 id="cta-heading" className="lg:col-span-8 h-section !text-[clamp(1.625rem,1.1rem+2vw,2.5rem)] !leading-[1.1]">
          The phone will ring while you&rsquo;re on a job. Have something answer it.
        </h2>
        <div className="lg:col-span-4 flex flex-wrap items-center gap-4 lg:justify-end">
          <Link href="/signup" className="btn btn-on-band">
            Create your account
          </Link>
          <Link
            href="/login"
            className="text-[14px] font-medium underline underline-offset-4 decoration-1 hover:decoration-2"
            style={{ color: "var(--band-ink)" }}
          >
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}
