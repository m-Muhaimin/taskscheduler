import { SectionHeading } from "./section-heading";

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
    <section id="how" className="container-x section" aria-labelledby="how-heading">
      <div className="grid lg:grid-cols-12 gap-6 lg:gap-10">
        <div className="lg:col-span-4 lg:sticky lg:top-24 lg:self-start">
          <SectionHeading id="how-heading" eyebrow="How it works" title="From missed call to booked job." />
        </div>

        <ol className="lg:col-span-7 lg:col-start-6 card divided overflow-hidden">
          {STEPS.map((s) => (
            <li key={s.n} className="reveal flex gap-4 p-4 md:p-5">
              <span className="w-7 h-7 shrink-0 rounded-full bg-surface-2 border border-border flex items-center justify-center font-mono text-[11px] text-ink-muted">
                {s.n}
              </span>
              <div>
                <h3 className="font-head font-semibold text-[17px] leading-[1.25] tracking-[-0.01em]">{s.title}</h3>
                <p className="text-[14px] leading-[1.6] text-ink-muted mt-1.5 max-w-[56ch]">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
