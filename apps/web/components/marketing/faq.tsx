import { Plus } from "lucide-react";

const QUESTIONS = [
  {
    q: "What happens when the AI isn\u2019t sure?",
    a: "It stops replying and flags the conversation in your AI Inbox with the reason. You answer, so the customer never gets a guess.",
  },
  {
    q: "Does it handle emergencies?",
    a: "It recognizes them, pauses the conversation, and puts a banner and a Take over button at the top of your dashboard. It does not try to dispatch an emergency on its own.",
  },
  {
    q: "Can I turn it off?",
    a: "Yes. The AI front desk switch in the dashboard top bar pauses it. Flip it back when you want it answering again.",
  },
  {
    q: "Can I take deposits?",
    a: "There is a setting that asks first-time customers for a $50 deposit before confirming. It is off until you switch it on.",
  },
  {
    q: "Will it ask my customers for reviews?",
    a: "If you leave the setting on, it texts a review link when you mark a job complete.",
  },
] as const;

export function Faq() {
  return (
    <section id="faq" className="max-w-[1200px] mx-auto px-6 md:px-12 pb-24" aria-labelledby="faq-heading">
      <div className="grid lg:grid-cols-12 gap-12 lg:gap-8 border-t border-border-strong pt-24">
        <div className="lg:col-span-4">
          <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-muted mb-4">Questions</p>
          <h2
            id="faq-heading"
            className="font-head font-semibold text-[clamp(1.875rem,3.6vw,2.75rem)] leading-[1.08] tracking-[-0.02em]"
          >
            What owners ask first.
          </h2>
        </div>

        <div className="lg:col-span-7 lg:col-start-6 border-b border-border-strong">
          {QUESTIONS.map((item) => (
            <details key={item.q} className="faq border-t border-border-strong">
              <summary className="flex items-center justify-between gap-6 py-6 min-h-[44px] cursor-pointer rounded-[10px]">
                <span className="text-[18px] font-medium leading-snug">{item.q}</span>
                <Plus size={20} className="faq-plus shrink-0 text-ink-muted" aria-hidden="true" />
              </summary>
              <p className="text-[17px] leading-[1.6] text-ink-muted pb-6 max-w-[56ch]">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
