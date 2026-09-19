import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
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
    <div className="min-h-dvh grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div className="bg-surface flex flex-col px-5 md:px-10 py-4">
        <header className="flex items-center justify-between">
          <Logo />
          <ThemeToggle />
        </header>

        <main id="main" className="animate-rise flex-1 flex flex-col justify-center w-full max-w-[360px] mx-auto py-8">
          <h1 className="h-page">{title}</h1>
          <p className="text-ink-muted text-[14px] leading-[1.55] mt-2 mb-6">{subtitle}</p>
          {children}
          <div className="mt-6 pt-4 border-t border-border text-[13px] text-ink-muted">{footer}</div>
        </main>

        <p className="text-center font-mono text-[11px] text-ink-faint">
          <Link href="/" className="hover:text-ink transition-colors">
            &larr; Back to home
          </Link>
        </p>
      </div>

      <AuthAside heading={asideHeading} />
    </div>
  );
}
