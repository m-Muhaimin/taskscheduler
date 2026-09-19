import { SessionProvider } from "@/lib/session";
import { NavRail } from "@/components/dashboard/nav-rail";
import { TopBar } from "@/components/dashboard/top-bar";
import { EscalationBanner } from "@/components/dashboard/escalation-banner";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="min-h-screen flex">
        <NavRail />
        <div className="flex-1 min-w-0 flex flex-col">
          <TopBar />
          <EscalationBanner />
          <main className="flex-1 px-5 md:px-8 py-6 md:py-7 max-w-[1400px] w-full mx-auto animate-rise">
            {children}
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}
