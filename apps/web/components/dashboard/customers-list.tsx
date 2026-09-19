"use client";

import { Fragment, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { Customer } from "@/lib/types";

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("");
}

/** Wraps the matched part of `text` in <mark>. */
function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i === -1) return <>{text}</>;
  return (
    <Fragment>
      {text.slice(0, i)}
      <mark className="hl">{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length)}
    </Fragment>
  );
}

export function CustomersList({ customers }: { customers: Customer[] }) {
  const [term, setTerm] = useState("");
  const t = term.trim();

  const filtered = useMemo(() => {
    const q = t.toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q));
  }, [customers, t]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 mb-4">
        <div>
          <h2 className="font-head font-semibold text-[15px]">Customers</h2>
          <p className="text-[12.5px] text-ink-muted mt-0.5" aria-live="polite">
            {t ? `${filtered.length} of ${customers.length} customers` : `${customers.length} customers`}
          </p>
        </div>
        <div className="relative w-full sm:w-60">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setTerm("");
            }}
            aria-label="Search customers"
            placeholder={"Search customers\u2026"}
            className="field pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
          />
          {term && (
            <button
              type="button"
              onClick={() => setTerm("")}
              aria-label="Clear search"
              className="fade-in absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-[8px] flex items-center justify-center text-ink-faint hover:text-ink hover:bg-surface-2 transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {filtered.length > 0 && (
        <div className="card overflow-hidden divided">
          {filtered.map((c, i) => (
            <div
              key={c.id}
              className="metric-card-rise flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors"
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            >
              <div className="w-8 h-8 rounded-full bg-surface-2 border border-border flex items-center justify-center text-[11px] font-mono text-ink-muted shrink-0">
                {initials(c.name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium truncate">
                  <Highlight text={c.name} term={t} />
                </p>
                <p className="text-[12px] text-ink-muted font-mono">{c.phone}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[12.5px] font-mono">{c.jobCount} jobs</p>
                <p className="text-[11px] text-ink-faint">since {c.customerSince}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {t && filtered.length === 0 && (
        <div className="fade-in card text-center text-[13px] text-ink-muted py-10 px-4">
          <p>No customers match &quot;{t}&quot;.</p>
          <button type="button" onClick={() => setTerm("")} className="link mt-2 text-[13px]">
            Clear search
          </button>
        </div>
      )}
    </div>
  );
}
