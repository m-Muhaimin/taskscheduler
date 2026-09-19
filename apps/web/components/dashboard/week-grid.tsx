const DAYS = [
  { label: "Mon", date: 22 },
  { label: "Tue", date: 23 },
  { label: "Wed", date: 24 },
  { label: "Thu", date: 25 },
  { label: "Fri", date: 26 },
  { label: "Sat", date: 27 },
  { label: "Sun", date: 28 },
];

const WEEK_DATA: string[][] = [
  ["9:00 Sarah K.", "1:00 Reyes"],
  ["9:00 Kim", "10:30 Anand", "12:00 Whitfield", "2:00 Fischer", "4:30 Torres"],
  ["11:00 Boyd"],
  ["9:30 Nguyen", "3:00 Patel"],
  ["8:00 Cole", "1:30 Ramirez"],
  ["10:00 Ferreira"],
  [],
];

const TODAY_INDEX = 1;

export function WeekGrid() {
  return (
    <div>
      <div className="grid grid-cols-7 gap-3">
        {DAYS.map((day, i) => (
          <div
            key={day.label}
            className="text-center pb-2 border-b-2"
            style={{ borderColor: i === TODAY_INDEX ? "var(--accent)" : "var(--border)" }}
          >
            <p
              className={`text-[11px] font-medium uppercase tracking-wide ${
                i === TODAY_INDEX ? "" : "text-ink-faint"
              }`}
              style={{ color: i === TODAY_INDEX ? "var(--accent)" : undefined }}
            >
              {day.label}
            </p>
            <p className={`font-mono text-sm mt-0.5 ${i === TODAY_INDEX ? "font-semibold" : ""}`}>
              {day.date}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-3 mt-3">
        {WEEK_DATA.map((day, i) =>
          day.length === 0 ? (
            <div
              key={i}
              className="border border-dashed border-border rounded-[8px] p-2 min-h-[140px] flex items-center justify-center"
            >
              <span className="text-[11px] text-ink-faint">No jobs</span>
            </div>
          ) : (
            <div
              key={i}
              className="border border-border rounded-[8px] p-2 min-h-[140px]"
              style={{ background: i === TODAY_INDEX ? "var(--surface-2)" : undefined }}
            >
              {day.map((item, idx) => (
                <div
                  key={idx}
                  className="appt-block pl-2 py-1 mb-1.5 rounded-r-[5px] text-[11px] leading-tight"
                >
                  {item}
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
