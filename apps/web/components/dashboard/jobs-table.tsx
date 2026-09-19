import type { JobRow } from "@/lib/types";

const STATUS_COLOR: Record<JobRow["status"], string> = {
  Completed: "var(--success)",
  "Needs dispatch": "var(--danger)",
  Scheduled: "var(--ink-muted)",
  "In progress": "var(--ink-muted)",
};

export function JobsTable({ jobs }: { jobs: JobRow[] }) {
  return (
    <div className="border border-border rounded-[10px] bg-surface overflow-hidden">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-ink-faint text-[11px] uppercase tracking-wide border-b border-border">
            <th className="font-medium px-4 py-2.5">Customer</th>
            <th className="font-medium px-4 py-2.5">Service</th>
            <th className="font-medium px-4 py-2.5">Technician</th>
            <th className="font-medium px-4 py-2.5">Status</th>
            <th className="font-medium px-4 py-2.5 text-right">Value</th>
          </tr>
        </thead>
        <tbody className="[&>*+*]:border-t [&>*+*]:border-border">
          {jobs.map((job, i) => (
            <tr
              key={job.id}
              className="hover:bg-surface-2 transition-colors metric-card-rise"
              style={{ animationDelay: `${i * 45}ms` }}
            >
              <td className="px-4 py-2.5">{job.customer}</td>
              <td className="px-4 py-2.5 text-ink-muted">{job.service}</td>
              <td className="px-4 py-2.5 text-ink-muted">{job.technician}</td>
              <td className="px-4 py-2.5" style={{ color: STATUS_COLOR[job.status] }}>
                {job.status}
              </td>
              <td className="px-4 py-2.5 text-right font-mono">{job.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
