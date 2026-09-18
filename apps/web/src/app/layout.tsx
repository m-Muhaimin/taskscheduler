import type { Metadata } from "next"
import type { ReactNode } from "react"
import { Toaster } from "sonner"

import "./globals.css"

export const metadata: Metadata = {
  title: "Solo Sam",
  description: "Daily scheduling for solo tradespeople",
}

/** Root layout is intentionally bare so auth pages (/login, /register) render
 *  without the dashboard shell. The shell lives in app/dashboard/layout.tsx. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster position="bottom-center" offset={90} />
      </body>
    </html>
  )
}
