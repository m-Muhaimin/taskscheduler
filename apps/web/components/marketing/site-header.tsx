import Link from "next/link";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#handoff", label: "Emergencies" },
  { href: "#faq", label: "FAQ" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 bg-bg border-b border-border">
      <div className="max-w-[1200px] mx-auto px-6 md:px-12 h-16 flex items-center gap-8">
        <Link href="/" className="flex items-center gap-3 rounded-[10px]" aria-label="Ridgeline home">
          <span className="w-8 h-8 rounded-[10px] bg-accent-deep text-accent-ink flex items-center justify-center font-head font-bold text-sm">
            R
          </span>
          <span className="font-head font-semibold text-[16px]">Ridgeline</span>
        </Link>

        <nav aria-label="Primary" className="hidden md:flex items-center gap-2">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="px-3 h-11 inline-flex items-center rounded-[10px] text-[14px] font-medium text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle large />
          <Link
            href="/login"
            className="hidden sm:inline-flex px-3 h-11 items-center rounded-[10px] text-[14px] font-medium hover:bg-surface-2 transition-colors"
          >
            Sign in
          </Link>
          <Link href="/signup" className="btn btn-primary">
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
