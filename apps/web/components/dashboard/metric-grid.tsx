import { MetricCard, type MetricCardProps } from "./metric-card";

export interface MetricGridItem extends Omit<MetricCardProps, "delayMs"> {
  id: string;
}

export function MetricGrid({ items }: { items: MetricGridItem[] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-7">
      {items.map((item, i) => (
        <MetricCard key={item.id} {...item} delayMs={i * 70} />
      ))}
    </div>
  );
}
