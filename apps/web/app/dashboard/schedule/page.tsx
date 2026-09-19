import { WeekGrid } from "@/components/dashboard/week-grid";

export default function SchedulePage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="font-head font-semibold text-[15px]">This week</p>
        <div className="flex items-center gap-1 text-[12.5px] font-mono text-ink-muted">
          <button className="w-7 h-7 rounded-[7px] border border-border-strong flex items-center justify-center hover:bg-surface-2">
            ‹
          </button>
          <span className="px-2">Sep 22 – Sep 28</span>
          <button className="w-7 h-7 rounded-[7px] border border-border-strong flex items-center justify-center hover:bg-surface-2">
            ›
          </button>
        </div>
      </div>
      <WeekGrid />
    </div>
  );
}
