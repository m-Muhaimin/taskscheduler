import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export function SiteFooter() {
  return (
    <footer className="band border-t border-band-rule">
      <div className="container-x py-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <Logo tone="band" />
        <nav aria-label="Footer" className="flex items-center gap-5 text-[13px]" style={{ color: "var(--band-muted)" }}>
          <Link href="/login" className="hover:text-[color:var(--band-ink)] transition-colors">
            Sign in
          </Link>
          <Link href="/signup" className="hover:text-[color:var(--band-ink)] transition-colors">
            Create account
          </Link>
        </nav>
        <p className="font-mono text-[11.5px]" style={{ color: "var(--band-muted)" }}>
          &copy; 2026 Ridgeline
        </p>
      </div>
    </footer>
  );
}
