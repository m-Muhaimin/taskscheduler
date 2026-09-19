import type { ReactNode } from "react";

interface SectionHeadingProps {
  id: string;
  eyebrow: string;
  title: string;
  children?: ReactNode;
  /** "band" recolours the eyebrow/lede for the dark bands. */
  tone?: "default" | "band";
}

/** Eyebrow + h2 + optional lede. One implementation for every landing section. */
export function SectionHeading({ id, eyebrow, title, children, tone = "default" }: SectionHeadingProps) {
  const muted = tone === "band" ? { color: "var(--band-muted)" } : undefined;
  return (
    <div>
      <p className="eyebrow mb-3" style={muted}>
        {eyebrow}
      </p>
      <h2 id={id} className="h-section">
        {title}
      </h2>
      {children && (
        <div className="lede mt-4 space-y-3" style={muted}>
          {children}
        </div>
      )}
    </div>
  );
}
