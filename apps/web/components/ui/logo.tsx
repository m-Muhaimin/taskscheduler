import Link from "next/link";
import clsx from "clsx";

/** The one Ridgeline mark. Used by the sidebar, marketing header/footer and the auth pages. */
export function LogoMark({ tone = "accent", className }: { tone?: "accent" | "band"; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        "w-8 h-8 shrink-0 rounded-[9px] flex items-center justify-center font-head font-bold text-sm",
        tone === "accent" ? "bg-accent-deep text-accent-ink" : "bg-band-accent",
        className
      )}
      style={tone === "band" ? { color: "#1c1006" } : undefined}
    >
      R
    </span>
  );
}

interface LogoProps {
  href?: string;
  /** Small second line under the wordmark (the sidebar uses this). */
  subtitle?: string;
  tone?: "accent" | "band";
  className?: string;
  onClick?: () => void;
}

export function Logo({ href = "/", subtitle, tone = "accent", className, onClick }: LogoProps) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label="Ridgeline home"
      className={clsx("inline-flex items-center gap-2.5 rounded-[10px] group", className)}
    >
      <LogoMark tone={tone} className="transition-transform duration-300 [@media(hover:hover)]:group-hover:-rotate-6" />
      <span className="min-w-0">
        <span className="block font-head font-semibold text-[15px] leading-none">Ridgeline</span>
        {subtitle && <span className="block text-[11px] text-ink-faint leading-none mt-1">{subtitle}</span>}
      </span>
    </Link>
  );
}
