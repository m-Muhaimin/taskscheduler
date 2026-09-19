import { FaqList } from "./faq-list";
import { SectionHeading } from "./section-heading";

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
    <section id="faq" className="container-x pb-12 md:pb-16" aria-labelledby="faq-heading">
      <div className="grid lg:grid-cols-12 gap-6 lg:gap-10 border-t border-border-strong pt-12 md:pt-16">
        <div className="lg:col-span-4">
          <SectionHeading id="faq-heading" eyebrow="Questions" title="What owners ask first." />
        </div>
        <div className="lg:col-span-7 lg:col-start-6">
          <FaqList items={QUESTIONS} />
        </div>
      </div>
    </section>
  );
}
