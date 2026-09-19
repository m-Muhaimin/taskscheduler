const STEPS = [
  {
    n: "01",
    title: "A call goes unanswered.",
    body: "Ridgeline notices the missed call and texts the caller right away, before they dial the next shop on the list.",
  },
  {
    n: "02",
    title: "The AI asks what\u2019s wrong.",
    body: "A few plain questions: what\u2019s failing, how bad it is, when they\u2019re home. Then it offers a real opening from your calendar.",
  },
  {
    n: "03",
    title: "The job lands on your schedule.",
    body: "You see the customer, the problem, and the tech assigned. Anything the AI can\u2019t settle waits for you in the AI Inbox.",
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how" className="max-w-[1200px] mx-auto px-6 md:px-12 py-24" aria-labelledby="how-heading">
      <div className="grid lg:grid-cols-12 gap-12 lg:gap-8">
        <div className="lg:col-span-4 lg:sticky lg:top-24 lg:self-start">
          <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-muted mb-4">How it works</p>
          <h2
            id="how-heading"
            className="font-head font-semibold text-[clamp(1.875rem,3.6vw,2.75rem)] leading-[1.08] tracking-[-0.02em]"
          >
            From missed call to booked job.
          </h2>
        </div>

        <ol className="lg:col-span-7 lg:col-start-6 border-b border-border-strong">
          {STEPS.map((s) => (
            <li
              key={s.n}
              className="reveal grid sm:grid-cols-[64px_1fr] gap-4 py-8 border-t border-border-strong"
            >
              <span className="font-mono text-[14px] text-ink-muted pt-1">{s.n}</span>
              <div>
                <h3 className="font-head font-semibold text-[24px] leading-[1.15] tracking-[-0.01em]">{s.title}</h3>
                <p className="text-[17px] leading-[1.6] text-ink-muted mt-3 max-w-[56ch]">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
