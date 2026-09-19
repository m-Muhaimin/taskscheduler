import { ToggleList, type ToggleRow } from "@/components/ui/toggle-list";
import { SectionHeading } from "./section-heading";

const ROWS: ToggleRow[] = [
  {
    id: "ai-front-desk",
    title: "AI front desk",
    description: "Answers, qualifies, and books new inquiries without you.",
    defaultOn: true,
  },
  {
    id: "review-requests",
    title: "Auto-send review requests",
    description: "Texts a review link when a job is marked complete.",
    defaultOn: true,
  },
  {
    id: "deposit-required",
    title: "Deposit required for new bookings",
    description: "Asks first-time customers for a $50 deposit before confirming.",
    defaultOn: false,
  },
];

export function Controls() {
  return (
    <section className="container-x section" aria-labelledby="controls-heading">
      <div className="grid lg:grid-cols-12 gap-6 lg:gap-10 lg:items-center">
        <div className="lg:col-span-5">
          <SectionHeading id="controls-heading" eyebrow="Your rules" title="You set the rules. The AI follows them.">
            <p>Every behavior that touches a customer has a switch. Try these. Nothing here is saved.</p>
          </SectionHeading>
        </div>
        {/* The exact component the dashboard Settings page renders */}
        <div className="lg:col-span-6 lg:col-start-7">
          <ToggleList rows={ROWS} />
        </div>
      </div>
    </section>
  );
}
