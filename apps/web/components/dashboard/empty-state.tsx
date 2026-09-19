import { Sparkles } from "lucide-react";

/**
 * Friendly zero/empty state used across the dashboard when an org has no data
 * yet (403 no_organization) or a collection comes back empty. Design-consistent
 * with the inbox empty state: card, centered muted copy, accent icon.
 */
export function EmptyState({
  title = "No data yet",
  description,
}: {
  title?: string;
  description: string;
}) {
  return (
    <div className="fade-in card flex flex-col items-center gap-2 text-center text-[13px] text-ink-muted py-10 px-4">
      <Sparkles size={20} style={{ color: "var(--accent)" }} aria-hidden="true" />
      <p className="text-ink font-medium">{title}</p>
      <p className="max-w-[38ch] leading-relaxed">{description}</p>
    </div>
  );
}