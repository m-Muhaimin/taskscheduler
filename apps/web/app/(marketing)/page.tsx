import { Hero } from "@/components/marketing/hero";
import { ResultsBand } from "@/components/marketing/results-band";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Handoff } from "@/components/marketing/handoff";
import { Controls } from "@/components/marketing/controls";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";

export default function LandingPage() {
  return (
    <>
      <Hero />
      <ResultsBand />
      <HowItWorks />
      <Handoff />
      <Controls />
      <Faq />
      <FinalCta />
    </>
  );
}
