import type { Appointment } from "@/lib/types";

export function TodayTimeline({
  appointments,
  nowPercent = 40,
}: {
  appointments: Appointment[];
  nowPercent?: number;
}) {
  return (
    <div className="border border-border rounded-[10px] bg-surface p-4">
      <div className="relative" style={{ minHeight: 260 }}>
        {appointments.map((a) => (
          <div
            key={a.id}
            className="appt-block pl-3 py-1.5 absolute left-0 right-0 rounded-r-[6px]"
            style={{
              top: `${a.topPercent}%`,
              borderLeftColor: a.urgent ? "var(--danger)" : undefined,
            }}
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[11px] text-ink-faint">{a.time}</span>
              <span className="text-[12.5px] font-medium truncate">{a.label}</span>
            </div>
            <p className="text-[11px] text-ink-faint">Tech: {a.tech}</p>
          </div>
        ))}
        <div className="timeline-now" style={{ top: `${nowPercent}%` }} />
      </div>
    </div>
  );
}
