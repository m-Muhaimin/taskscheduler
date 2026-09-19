import { JobsTable } from "@/components/dashboard/jobs-table";
import { jobs } from "@/lib/fixtures";

export default function JobsPage() {
  return (
    <div>
      <p className="font-head font-semibold text-[15px] mb-4">Jobs</p>
      <JobsTable jobs={jobs} />
    </div>
  );
}
