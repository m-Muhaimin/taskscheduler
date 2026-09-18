import type { Metadata } from "next"

import { ChartBarInteractive } from "@/components/chart-bar-interactive"

export const metadata: Metadata = {
  title: "Chart demo — Solo Sam",
}

/**
 * Standalone chart demo. Lives outside the dashboard shell (and its session
 * gate) so it can be viewed without registering. Demo data only — delete
 * this route before shipping.
 */
export default function ChartDemoPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 lg:px-6">
      <div className="space-y-3">
        <div>
          <h1 className="text-base font-semibold">Chart demo</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            shadcn interactive bar chart — demo data, not wired to an API.
          </p>
        </div>
        <ChartBarInteractive />
      </div>
    </main>
  )
}
