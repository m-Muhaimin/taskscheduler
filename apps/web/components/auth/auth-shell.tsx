import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { Card } from "@/components/ui/card";
import { AuthAside } from "./auth-aside";

interface AuthShellProps {
  title: string;
  subtitle: string;
  asideHeading: string;
  children: ReactNode;
  footer: ReactNode;
}

export function AuthShell({ title, subtitle, asideHeading, children, footer }: AuthShellProps) {
  return (
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
      <div className="bg-surface flex flex-col px-6 md:px-12 py-6">
        <header className="h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 rounded-[10px]" aria-label="Ridgeline home">
            <span className="w-8 h-8 rounded-[10px] bg-accent-deep text-accent-ink flex items-center justify-center font-head font-bold text-sm">
              R
            </span>
            <span className="font-head font-semibold text-[16px]">Ridgeline</span>
          </Link>
          <ThemeToggle large />
        </header>

        <main className="flex-1 flex flex-col justify-center w-full max-w-[400px] mx-auto py-10">
          <Card className="p-6 md:p-8">
            <h1 className="font-head font-semibold text-[28px] leading-[1.1] tracking-[-0.02em]">{title}</h1>
            <p className="text-ink-muted text-[16px] leading-[1.55] mt-3 mb-8">{subtitle}</p>
            {children}
            <div className="mt-8 pt-6 border-t border-border text-[14px] text-ink-muted">{footer}</div>
          </Card>
        </main>
      </div>

      <AuthAside heading={asideHeading} />
    </div>
  );
}
