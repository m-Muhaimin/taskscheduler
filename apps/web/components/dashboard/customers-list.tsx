"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { Customer } from "@/lib/types";

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("");
}

export function CustomersList({ customers }: { customers: Customer[] }) {
  const [term, setTerm] = useState("");

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(t));
  }, [customers, term]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="font-head font-semibold text-[15px]">Customers</p>
        <div className="relative w-56">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={"Search customers\u2026"}
            className="w-full text-[13px] pl-8 pr-3 py-1.5 rounded-[8px] border border-border-strong bg-transparent outline-none"
          />
        </div>
      </div>

      <div className="border border-border rounded-[10px] bg-surface overflow-hidden [&>*+*]:border-t [&>*+*]:border-border">
        {filtered.map((c) => (
          <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors">
            <div className="w-8 h-8 rounded-full bg-surface-2 border border-border flex items-center justify-center text-[11px] font-mono text-ink-muted shrink-0">
              {initials(c.name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium truncate">{c.name}</p>
              <p className="text-[12px] text-ink-muted font-mono">{c.phone}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[12.5px] font-mono">{c.jobCount} jobs</p>
              <p className="text-[11px] text-ink-faint">since {c.customerSince}</p>
            </div>
          </div>
        ))}
      </div>

      {term && filtered.length === 0 && (
        <p className="text-center text-sm text-ink-muted py-10 border border-border rounded-[10px] mt-4">
          No customers match &quot;{term}&quot;.
        </p>
      )}
    </div>
  );
}
