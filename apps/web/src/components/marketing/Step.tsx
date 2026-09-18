import { Badge } from "@/components/ui/badge";

interface StepProps {
  number: string;
  title: string;
  description: string;
}

export default function Step({ number, title, description }: StepProps) {
  return (
    <div className="flex gap-6 items-start group">
      <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xl font-bold ring-4 ring-primary/10 group-hover:ring-primary/30 transition-all">
        {number}
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}
