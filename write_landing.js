const fs = require('fs');

const content = `import Hero from "@/components/marketing/Hero";
import FeatureCard from "@/components/marketing/FeatureCard";
import Step from "@/components/marketing/Step";
import PricingCard from "@/components/marketing/PricingCard";
import CTASection from "@/components/marketing/CTASection";
import FAQItem from "@/components/marketing/FAQItem";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Hero />

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
              You're under a sink, in a crawlspace, or driving. By the time you check voicemail, the customer has already called the next person on Google.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <FeatureCard 
              urgent 
              title="The Voicemail Gap" 
              description="Customers rarely leave voicemails anymore. They just hang up and call the next pro." 
              benefit="Instant SMS responses keep the lead warm." 
            />
            <FeatureCard 
              urgent 
              title="Phone Tag Fatigue" 
              description="Spending your evenings playing phone tag just to confirm a Tuesday appointment." 
              benefit="Auto-confirmations handle the back-and-forth." 
            />
            <FeatureCard 
              urgent 
              title="The Double-Book" 
              description="Managing appointments across a notebook, a phone, and memory leads to costly errors." 
              benefit="Real-time Google Calendar sync prevents overlaps." 
            />
            <FeatureCard 
              urgent 
              title="Reschedule Chaos" 
              description="A simple 'Can we move this to Wednesday?' turns into a 4-hour conversation." 
              benefit="Reschedules handled via SMS without the phone tag." 
            />
          </div>
        </div>
      </section>

      <section className="py-24 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-16 space-y-4">
            <Badge variant="outline" className="text-primary border-primary font-medium">
              The Solution
            </Badge>
            <h2 className="text-3xl font-heading font-bold tracking-tight text-foreground lg:text-5xl">
              Your business, on autopilot.
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              TradeScheduler acts as your AI dispatch assistant, ensuring no lead goes cold and every job is confirmed.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
              description="Your customers don't need to download an app or create an account. Just SMS." 
              benefit="Higher conversion rates." 
            />
            <FeatureCard 
              title="Solo-Trade Optimized" 
              description="Built specifically for plumbers, electricians, and HVAC techs." 
              benefit="Tools that fit your trade." 
            />
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-muted/30">
        <div className="container mx-auto max-w-4xl">
          <div className="text-center mb-16 space-y-4">
            <Badge variant="outline" className="text-primary border-primary font-medium">
              The Process
            </Badge>
            <h2 className="text-3xl font-heading font-bold tracking-tight text-foreground lg:text-5xl">
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
              title="AI handles the booking" 
              description="Our assistant engages via SMS, finds a time that works, and secures the confirmation." 
            />
            <Step 
              number="3" 
              title="You show up to the job" 
              description="The appointment appears on your Google Calendar. You just drive and work." 
            />
          </div>
        </div>
      </section>

      <section className="py-24 px-4">
        <div className="container mx-auto max-w-4xl text-center space-y-8">
          <h2 className="text-3xl font-heading font-bold tracking-tight text-foreground lg:text-4xl">
            Built for the people who keep the world running.
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {["Plumbers", "Electricians", "HVAC Techs"].map((trade) => (
              <div key={trade} className="p-6 rounded-lg border border-border bg-card font-medium text-foreground">
                {trade}
              </div>
            ))}
          </div>
          <p className="text-muted-foreground text-sm">
            No corporate fluff. No enterprise bloat. Just a tool that works as hard as you do.
          </p>
        </div>
      </section>

      <section className="py-24 px-4 bg-muted/30">
        <div className="container mx-auto max-w-5xl text-center space-y-12">
          <div className="space-y-4">
            <h2 className="text-3xl font-heading font-bold tracking-tight text-foreground lg:text-5xl">
              Simple, honest pricing.
            </h2>
            <p className="text-muted-foreground text-lg">
              One plan. Everything included. No hidden fees.
            </p>
          </div>
          <PricingCard />
        </div>
      </section>

      <section className="py-24 px-4">
        <div className="container mx-auto max-w-3xl space-y-12">
          <div className="text-center space-y-4">
            <h2 className="text-3xl font-heading font-bold tracking-tight text-foreground">
              Common Questions
            </h2>
          </div>
          <div className="divide-y divide-border">
            <FAQItem 
              question="Do my customers need to download an app?" 
              answer="No. Everything happens via standard SMS. Your customers just text and reply—no accounts or app store vi
