import { relativeTime } from "@/lib/format";
import type { RescheduleLogEntry } from "@tradescheduler/shared";

interface Props {
  entries: RescheduleLogEntry[];
  actionLabel: Record<string, string>;
}

export function RescheduleLogList({ entries, actionLabel }: Props) {
  return (
    <ul className="mt-2 space-y-2">
      {entries.map((entry, i) => (
        <li
          key={`${entry.action}-${entry.timestamp}-${i}`}
          className="flex items-start justify-between gap-4 text-sm"
        >
          <span>{actionLabel[entry.action] ?? entry.action}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {relativeTime(entry.timestamp)}
          </span>
        </li>
      ))}
    </ul>
  );
}
