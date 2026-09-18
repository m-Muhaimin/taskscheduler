import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface FeatureCardProps {
  title: string;
  description: string;
  benefit: string;
  urgent?: boolean;
}

export default function FeatureCard({ title, description, benefit, urgent }: FeatureCardProps) {
  return (
    <Card className={`relative overflow-hidden transition-all hover:border-primary/50 ${urgent ? 'border-urgent/30 bg-urgent-soft/20' : ''}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between mb-2">
          <Badge variant={urgent ? "destructive" : "secondary"} className={urgent ? "bg-urgent text-white" : ""}>
            {urgent ? "Pain Point" : "Feature"}
          </Badge>
        </div>
        <CardTitle className="text-xl font-semibold tracking-tight">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm leading-relaxed">
          {description}
        </p>
        <div className="pt-3 border-t border-border">
          <p className="text-sm font-medium text-foreground">
            <span className="text-primary mr-2">→</span> {benefit}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
