import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

export default function PricingCard() {
  return (
    <Card className="max-w-sm mx-auto relative border-primary shadow-xl shadow-primary/5 overflow-hidden">
      <div className="absolute top-0 right-0 bg-primary text-primary-foreground px-4 py-1 text-xs font-bold uppercase tracking-widest rounded-bl-lg">
        Most Popular
      </div>
      <CardHeader className="text-center pb-8">
        <CardTitle className="text-3xl font-bold tracking-tighter">Trade Pro</CardTitle>
        <div className="mt-4 flex items-baseline justify-center gap-1">
          <span className="text-4xl font-bold tracking-tight">$29</span>
          <span className="text-muted-foreground text-lg">/month</span>
        </div>
        <p className="text-muted-foreground text-sm mt-2">Everything you need to stop the phone tag.</p>
      </CardHeader>
      <CardContent className="space-y-4 pb-8">
        {[
          "AI-powered SMS booking",
          "Auto-confirmations",
          "Google Calendar sync",
          "Reschedule handling",
          "Unlimited booking requests",
          "Beta early access support"
        ].map((feature) => (
          <div key={feature} className="flex items-center gap-3 text-sm text-muted-foreground">
            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Check className="w-3 h-3" />
            </div>
            {feature}
          </div>
        ))}
      </CardContent>
      <CardFooter>
        <Button className="w-full h-12 text-base font-semibold">
          Start Free Trial
        </Button>
      </CardFooter>
    </Card>
  );
}
