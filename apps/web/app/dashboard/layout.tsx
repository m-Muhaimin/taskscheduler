import { SessionProvider } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/shell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <DashboardShell>{children}</DashboardShell>
    </SessionProvider>
  );
}
