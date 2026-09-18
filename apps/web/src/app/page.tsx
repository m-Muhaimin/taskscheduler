import Hero from "@/components/marketing/Hero";
import Step from "@/components/marketing/Step";
import PricingCard from "@/components/marketing/PricingCard";
import Nav from "@/components/marketing/Nav";
import FeatureCard from "@/components/marketing/FeatureCard";
import FeatureGrid from "@/components/marketing/FeatureGrid";
import StatsBar from "@/components/marketing/StatsBar";
import Testimonials from "@/components/marketing/Testimonials";
import FAQ from "@/components/marketing/FAQ";
import CTASection from "@/components/marketing/CTASection";
import Footer from "@/components/marketing/Footer";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Nav />
      <Hero />

      {/* Stats row */}
      <StatsBar
        stats={[
          { value: "50+", label: "Solo tradespeople onboarded" },
          { value: "1,200+", label: "Bookings confirmed via SMS" },
          { value: "98%", label: "Auto-confirmation success rate" },
          { value: "3", label: "Trades supported (plumbing, electrical, HVAC)" },
        ]}
      />

      {/* The Problem — pain points */}
      <section className="py-24 px-4 bg-muted/30">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-16 space-y-4">
            <Badge variant="outline" className="text-urgent border-urgent font-medium">
              The Problem
            </Badge>
            <h2 className="text-3xl font-heading font-bold tracking-tight text-foreground lg:text-5xl">
              Every missed call is a job that went to someone else.
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              You're under a sink, in a crawlspace, or driving. By the time you check voicemail,
              the customer has already called the next person on Google.
            </p>
          </div>
          <FeatureGrid columns={2}>
            <FeatureCard
              title="The Voicemail Gap"
              description="Customers rarely leave voicemails anymore. They just hang up and call the next pro."
              benefit="Instant SMS responses keep the lead warm."
              urgent
            />
            <FeatureCard
              title="Phone Tag Fatigue"
              description="Spending your evenings playing phone tag just to confirm a Tuesday appointment."
              benefit="Auto-confirmations handle the back-and-forth."
              urgent
            />
            <FeatureCard
              title="The Double-Book"
              description="Managing appointments across a notebook, a phone, and memory leads to costly errors."
              benefit="Real-time Google Calendar sync prevents overlaps."
              urgent
            />
            <FeatureCard
              title="Reschedule Chaos"
              description="A simple 'Can we move this to Wednesday?' turns into a 4-hour conversation."
              benefit="Reschedules handled via SMS without the phone tag."
              urgent
            />
          </FeatureGrid>
        </div>
      </section>

      {/* The Solution — features */}
      <section className="py-24 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-16 space-y-4">
            <Badge variant="outline" className="text-primary border-primary font-medium">
              The Solution
            </Badge>
            <h2 className="text-3xl font-heading font-bold tracking-tight text-foreground lg:text-5xl"
            id="features">
              Your business, on autopilot.
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              TradeScheduler acts as your AI dispatch assistant — no lead goes cold, every job is
              confirmed.
            </p>
          </div>
          <FeatureGrid columns={3}>
            <FeatureCard
              title="Missed Calls → Booked Jobs"
              description="When you can't pick up, we respond via SMS to qualify the lead and suggest times."
              benefit="Capture leads while you work."
            />
            <FeatureCard
              title="SMS Confirmations"
              description="No more guessing if they'll show up. We send a confirmation they can reply to."
              benefit="Reduced no-shows."
            />
            <FeatureCard
              title="Google Calendar Sync"
              description="Everything lands exactly where you already work. No new apps to learn."
              benefit="Single source of truth."
            />
            <FeatureCard
              title="Smart Rescheduling"
              description="Customers can request changes via text. We handle the logic and update your calendar."
              benefit="Save hours of admin."
            />
            <FeatureCard
              title="Zero-Friction Booking"
              description="Your customers don't need an app or an account — just SMS."
              benefit="Higher conversion rates."
            />
            <FeatureCard
              title="Solo-Trade Optimized"
              description="Built for plumbers, electricians, and HVAC techs — not call centers."
              benefit="Tools that fit your trade."
            />
          </FeatureGrid>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-4 bg-muted/30">
        <div className="container mx-auto max-w-4xl">
          <div className="text-center mb-16 space-y-4">
            <Badge variant="outline" className="text-primary border-primary font-medium">
              The Process
            </Badge>
            <h2 className="text-3xl font-heading font-bold tracking-tight text-foreground lg:text-5xl" id="how-it-works">
              Simple. Fast. Reliable.
            </h2>
          </div>
          <div className="grid gap-12">
            <Step
              number="1"
              title="Customer calls or texts"
              description="A new lead reaches out to your TradeScheduler number while you're on a job."
            />
            <Step
              number="2"
              title="AI triages and qualifies"
              description="TradeScheduler responds via SMS, suggests available times, and confirms the lead."
            />
            <Step
              number="3"
              title="Confirmed, calendar synced"
              description="The appointment lands in your Google Calendar — no typing, no double-booking."
            />
            <Step
              number="4"
              title="Reschedules handled automatically"
              description="Customers reply 'Can we move this?' and we handle the logic and notify you."
            />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-24 px-4" id="pricing">
        <div className="container mx-auto max-w-5xl text-center">
          <div className="mb-16 space-y-4">
            <Badge variant="outline" className="text-primary border-primary font-medium">
              Pricing
            </Badge>
            <h2 className="text-3xl font-heading font-bold tracking-tight text-foreground lg:text-5xl">
              One plan. Built for solo trades.
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              No per-lead fees, no tier gymnastics. One fair price until you're ready to grow.
            </p>
          </div>
          <div className="flex flex-col items-center gap-8">
            <PricingCard />
          </div>
        </div>
      </section>

      {/* Testimonial */}
      <Testimonials
        testimonials={[
          {
            quote: "Before TradeScheduler I was missing 3–4 jobs a week. Now every lead gets an SMS within seconds and I barely touch the phone until the job's booked.",
            author: "Mike R.",
            role: "Plumber, solo operator — 8 years",
          },
          {
            quote: "The reschedule thing alone is worth it. A customer texts 'Can we move to Thursday?' and by the time I check my phone it's already updated my calendar and confirmed the new time.",
            author: "Sarah K.",
            role: "HVAC technician, one-person shop",
          },
          {
            quote: "I was spending Sunday nights playing phone tag for the whole week. Now I show up, do the work, and the confirmations handle themselves.",
            author: "D. Patel",
            role: "Electrician — residential service",
          },
        ]}
      />

      {/* CTA */}
      <CTASection
        headline="Stop losing jobs to missed calls."
        subtext="TradeScheduler handles your bookings, confirmations, and reschedules via SMS — so you can focus on the work, not the phone tag."
      />

      {/* FAQ */}
      <FAQ
        items={[
          {
            question: "Do my customers need to download an app?",
            answer:
              "No. Everything happens over SMS — the same channel they already use to text you. No app, no account, no friction.",
          },
          {
            question: "What if I'm on a job and can't respond?",
            answer:
              "TradeScheduler responds automatically with available times and confirms the booking. You review the calendar when you're back, not while you're under a sink.",
          },
          {
            question: "How does the Google Calendar sync work?",
            answer:
              "Every confirmed booking lands in your Google Calendar automatically. Reschedules and cancellations update it in real time, so you always see the right schedule.",
          },
          {
            question: "Can I use my existing phone number?",
            answer:
              "Yes. TradeScheduler integrates with your Twilio number so customers text the same number they already have. Your personal line stays yours.",
          },
          {
            question: "Is there a trial or setup fee?",
            answer:
              "No credit card required for the beta trial. The Trade Pro plan is $29/month after the trial. Setup takes about 15 minutes — just connect your calendar and Twilio number.",
          },
        ]}
      />

      <Footer />
    </div>
  );
}
