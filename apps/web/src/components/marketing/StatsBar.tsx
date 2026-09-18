import { cn } from "@/lib/utils";

export function StatItem({ value, label, className, ...props }: React.HTMLAttributes<HTMLDivElement> & { value: string; label: string }) {
  return (
    <div className={cn("text-center md:text-left", className)} {...props}>
      <div className="text-3xl font-heading font-bold tracking-tight text-foreground">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

export default function StatsBar({ stats, accent = false, className, ...props }: React.HTMLAttributes<HTMLDivElement> & { stats: { value: string; label: string }[]; accent?: boolean }) {
  return (
    <section
      className={cn(
        "border-y bg-muted/30 py-10",
        accent && "bg-primary text-primary-foreground",
        className
      )}
      {...props}
    >
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((s) => (
            <StatItem key={s.label} value={s.value} label={s.label} />
          ))}
        </div>
      </div>
    </section>
  );
}
