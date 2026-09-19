"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { getWeekSchedule, useDashboardData } from "@/lib/dashboard-api";
import { WeekGridSkeleton } from "./skeletons";
import { ErrorState } from "./error-state";
import { EmptyState } from "./empty-state";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfWeek(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "2026-09-14" -> { weekday: "Mon", dayOfMonth: 14 } via UTC so the label is TZ-independent. */
function dayParts(isoDate: string): { weekday: string; dayOfMonth: number } {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { weekday: DAY_LABELS[(dow + 6) % 7], dayOfMonth: d };
}
const fmt = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};

/**
 * Week schedule from GET /api/dashboard/schedule. Offset 0 requests no params
 * so the API returns the org-tz current week; other offsets send weekStart/
 * weekEnd computed from the browser-local Monday. The "today" marker uses the
 * browser-local day-of-week as the brief's fallback.
 */
export function ScheduleView() {
  const [offset, setOffset] = useState(0);

  // null at offset 0 -> call the API without params (org-tz week default)
  const monday = offset === 0 ? null : addDays(startOfWeek(new Date()), offset * 7);
  const weekStart = monday ? iso(monday) : undefined;
  const weekEnd = monday ? iso(addDays(monday, 7)) : undefined;

  const { state, retry } = useDashboardData(
    () => getWeekSchedule(weekStart, weekEnd),
    [weekStart ?? "now"],
  );

  const todayIndex = offset === 0 ? (new Date().getDay() + 6) % 7 : -1;

  return (
    <div>
      <PageHeader
        title={
          offset === 0
            ? "This week"
            : offset > 0
              ? `${offset} week${offset > 1 ? "s" : ""} ahead`
              : `${-offset} week${offset < -1 ? "s" : ""} ago`
        }
        actions={
          <div className="flex items-center gap-1.5">
            {offset !== 0 && (
              <button type="button" onClick={() => setOffset(0)} className="btn btn-ghost btn-sm fade-in">
                Today
              </button>
            )}
            <button
              type="button"
              onClick={() => setOffset((o) => o - 1)}
              aria-label="Previous week"
              className="icon-btn w-8 h-8"
            >
              <ChevronLeft size={15} />
            </button>
            <span
              className="px-1 min-w-[112px] text-center text-[12.5px] font-mono text-ink-muted tabular-nums"
              aria-live="polite"
            >
              {state.status === "ready" ? `${fmt(state.data.days[0].date)} – ${fmt(state.data.days[6].date)}` : "\u00A0"}
            </span>
            <button
              type="button"
              onClick={() => setOffset((o) => o + 1)}
              aria-label="Next week"
              className="icon-btn w-8 h-8"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        }
      />

      {state.status === "loading" && <WeekGridSkeleton />}
      {state.status === "error" && <ErrorState message={state.message} onRetry={retry} label="the schedule" />}
      {state.status === "empty" && (
        <EmptyState
          title="No schedule yet"
          description="Once bookings start coming in, each day fills with appointments here."
        />
      )}

      {state.status === "ready" && (
        /* key restarts the entrance animation when the week changes */
        <div key={offset} className="grid grid-cols-1 md:grid-cols-7 gap-2 md:gap-3">
          {state.data.days.map((day, i) => {
            const { weekday, dayOfMonth } = dayParts(day.date);
            const isToday = i === todayIndex;
            const items = day.items;
            return (
              <div key={day.date} className="metric-card-rise" style={{ animationDelay: `${i * 40}ms` }}>
                <div
                  className="flex md:block items-baseline md:text-center gap-2 pb-2 border-b-2"
                  style={{ borderColor: isToday ? "var(--accent)" : "var(--border)" }}
                >
                  <p
                    className={`text-[11px] font-medium uppercase tracking-wide ${isToday ? "" : "text-ink-faint"}`}
                    style={{ color: isToday ? "var(--accent-deep)" : undefined }}
                  >
                    {weekday}
                  </p>
                  <p className={`font-mono text-sm md:mt-0.5 ${isToday ? "font-semibold" : ""}`}>{dayOfMonth}</p>
                  {isToday && (
                    <span className="md:hidden ml-auto text-[11px] font-mono" style={{ color: "var(--accent-deep)" }}>
                      today
                    </span>
                  )}
                </div>

                <div className="mt-2 md:mt-3">
                  {items.length === 0 ? (
                    <div className="border border-dashed border-border rounded-[8px] p-2 min-h-[44px] md:min-h-[140px] flex items-center justify-center">
                      <span className="text-[11px] text-ink-faint">No jobs</span>
                    </div>
                  ) : (
                    <div
                      className="card p-2 md:min-h-[140px] rounded-[8px]"
                      style={{ background: isToday ? "var(--surface-2)" : undefined }}
                    >
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className="appt-block pl-2 py-1 mb-1.5 last:mb-0 rounded-r-[5px] text-[11.5px] leading-tight"
                        >
                          <span className="font-mono text-ink-faint">{item.time}</span> {item.customerName}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}