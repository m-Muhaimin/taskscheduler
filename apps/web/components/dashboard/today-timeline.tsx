import type { Appointment } from "@/lib/types";

export function TodayTimeline({
  appointments,
  nowPercent = 44.5,
}: {
  appointments: Appointment[];
  nowPercent?: number;
}) {
  return (
    <div className="card p-4">
      {appointments.length === 0 ? (
        <div className="flex items-center justify-center text-center text-[12.5px] text-ink-muted min-h-[280px] px-4">
          No appointments scheduled for today.
        </div>
      ) : (
        <div className="relative" style={{ minHeight: 280 }}>
        {appointments.map((a, i) => (
          <div
            key={a.id}
            className="appt-block metric-card-rise pl-3 py-1.5 absolute left-0 right-0 rounded-r-[6px]"
            style={{
              top: `${a.topPercent}%`,
              borderLeftColor: a.urgent ? "var(--danger)" : undefined,
              animationDelay: `${i * 70}ms`,
            }}
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[11px] text-ink-faint">{a.time}</span>
              <span className="text-[12.5px] font-medium truncate">{a.label}</span>
            </div>
            <p className="text-[11px] text-ink-faint">Tech: {a.tech}</p>
          </div>
        ))}
        <div className="timeline-now" style={{ top: `${nowPercent}%` }}>
          <span
            className="absolute right-0 -top-[9px] px-1 rounded-[3px] font-mono text-[9.5px] leading-[14px]"
            style={{ background: "var(--surface)", color: "var(--accent-deep)" }}
          >
            now
          </span>
        </div>
        </div>
      )}
    </div>
  );
}
