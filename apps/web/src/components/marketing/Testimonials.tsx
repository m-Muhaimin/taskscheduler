import { cn } from "@/lib/utils";

export function Testimonial({ quote, author, role, className, ...props }: React.ComponentPropsWithoutRef<"blockquote"> & { quote: string; author: string; role: string }) {
  return (
    <blockquote
      className={cn(
        "rounded-xl border bg-card p-6 text-card-foreground shadow-sm",
        className
      )}
      {...props}
    >
      <p className="text-sm leading-relaxed text-muted-foreground italic">"{quote}"</p>
      <footer className="mt-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
          {author.charAt(0)}
        </div>
        <div>
          <div className="text-sm font-semibold">{author}</div>
          <div className="text-xs text-muted-foreground">{role}</div>
        </div>
      </footer>
    </blockquote>
  );
}

export default function Testimonials({ testimonials, className, ...props }: React.ComponentPropsWithoutRef<"section"> & { testimonials: { quote: string; author: string; role: string }[] }) {
  return (
    <section className={cn("space-y-12", className)} {...props}>
      <div className="text-center space-y-3">
        <h2 className="text-3xl font-heading font-bold tracking-tight">Trusted by solo tradespeople</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Join hundreds of plumbers, electricians, and HVAC techs who stopped losing jobs to missed calls.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {testimonials.map((t) => (
          <Testimonial key={t.author} {...t} />
        ))}
      </div>
    </section>
  );
}
