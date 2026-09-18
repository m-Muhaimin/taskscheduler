import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export default function CTASection({
  headline,
  subtext,
  accent = false,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  headline: string;
  subtext?: string;
  accent?: boolean;
}) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl border p-12 text-center",
        accent
          ? "bg-primary text-primary-foreground shadow-xl shadow-primary/20"
          : "bg-muted text-foreground",
        className
      )}
      {...props}
    >
      {!accent && (
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
      )}
      {accent && (
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary-foreground/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
      )}
      <div className="relative z-10">
        <h2 className="text-3xl font-heading font-bold tracking-tight lg:text-4xl mb-4">
          {headline}
        </h2>
        {subtext && (
          <p className="text-base text-primary-foreground/80 max-w-lg mx-auto mb-8">
            {subtext}
          </p>
        )}
        {children ? (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {children}
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" asChild>
              <Link
                href="/register"
                className="group gap-2"
              >
                Get Started Free
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground"
              asChild
            >
              <Link href="/login">Log in</Link>
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
