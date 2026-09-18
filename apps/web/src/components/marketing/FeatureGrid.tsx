import { cn } from "@/lib/utils";

export default function FeatureGrid({ columns = 3, className, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { columns?: 2 | 3 | 4 }) {
  return (
    <div
      className={cn(
        "grid gap-6 [grid-template-columns:repeat(auto-fill,minmax(0,1fr))] md:[grid-template-columns:repeat(2,1fr)] lg:[grid-template-columns:repeat(3,1fr)]",
        columns === 4 && "lg:[grid-template-columns:repeat(4,1fr)]",
        columns === 2 && "md:[grid-template-columns:repeat(1,1fr)] lg:[grid-template-columns:repeat(2,1fr)]",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
