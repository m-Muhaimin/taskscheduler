import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-background pt-16 pb-24 lg:pt-32 lg:pb-40">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-8 text-left">
            <div className="space-y-4">
              <Badge variant="outline" className="border-primary text-primary font-medium px-3 py-1">
                Now in Beta for Solo Trades
              </Badge>
              <h1 className="text-4xl font-heading font-bold tracking-tight text-foreground lg:text-6xl leading-[1.1]">
                Stop losing jobs to <span className="text-primary">missed calls.</span>
              </h1>
              <p className="text-lg text-muted-foreground max-w-lg leading-relaxed">
                TradeScheduler handles your bookings, confirmations, and reschedules via SMS—so you can focus on the work, not the phone tag.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-4">
              <Button size="lg" className="px-8 h-12 text-base font-semibold">
                Get Started Free
              </Button>
              <Button size="lg" variant="outline" className="px-8 h-12 text-base font-semibold">
                Watch Demo
              </Button>
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <div className="flex -space-x-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="w-8 h-8 rounded-full border-2 border-background bg-muted" />
                ))}
              </div>
              <span className="font-medium">Joined by 50+ solo tradespeople</span>
            </div>
          </div>
          <div className="relative lg:block">
            <div className="relative z-10 bg-card border border-border rounded-2xl shadow-2xl p-4 max-w-sm mx-auto">
              <div className="bg-muted rounded-t-xl p-3 border-b border-border flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">SMS Conversation</span>
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                </div>
              </div>
              <div className="p-4 space-y-4 bg-white dark:bg-slate-900 rounded-b-xl">
                <div className="flex justify-start">
                  <div className="bg-secondary text-secondary-foreground p-3 rounded-2xl rounded-tl-none text-sm max-w-[80%]">
                    Hi, I need a plumber for a leaky faucet on Tuesday.
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="bg-primary text-primary-foreground p-3 rounded-2xl rounded-tr-none text-sm max-w-[80%]">
                    I can do Tuesday at 2 PM. Does that work?
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="bg-secondary text-secondary-foreground p-3 rounded-2xl rounded-tl-none text-sm max-w-[80%]">
                    Yes, that works perfectly!
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="bg-primary text-primary-foreground p-3 rounded-2xl rounded-tr-none text-sm max-w-[80%]">
                    Confirmed! I've added you to my calendar for Tuesday @ 2 PM. See you then!
                  </div>
                </div>
              </div>
            </div>
            <div className="absolute -top-20 -right-20 w-64 h-64 bg-primary/10 rounded-full blur-3xl" />
            <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-urgent/10 rounded-full blur-3xl" />
          </div>
        </div>
      </div>
    </section>
  );
}
