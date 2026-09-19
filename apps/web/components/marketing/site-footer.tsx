import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="band border-t border-band-rule">
      <div className="max-w-[1200px] mx-auto px-6 md:px-12 py-16 md:py-20 flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-[10px] bg-band-accent flex items-center justify-center font-head font-bold text-sm" style={{ color: "#1c1006" }}>
            R
          </span>
          <span className="font-head font-semibold text-[16px]">Ridgeline</span>
        </div>
        <nav aria-label="Footer" className="flex items-center gap-6 text-[14px]" style={{ color: "var(--band-muted)" }}>
          <Link href="/login" className="hover:underline underline-offset-4">
            Sign in
          </Link>
          <Link href="/signup" className="hover:underline underline-offset-4">
            Create account
          </Link>
        </nav>
        <p className="font-mono text-[12px]" style={{ color: "var(--band-muted)" }}>
          &copy; 2026 Ridgeline
        </p>
      </div>
    </footer>
  );
}
