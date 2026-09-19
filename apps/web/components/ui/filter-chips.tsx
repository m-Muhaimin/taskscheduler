"use client";

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

interface FilterChipsProps<T extends string> {
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}

/** Single-select filter row with optional counts. Used by the inbox and jobs views. */
export function FilterChips<T extends string>({ options, value, onChange, label }: FilterChipsProps<T>) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="filter-chip"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {typeof o.count === "number" && (
            <span className="font-mono text-[11px] tabular-nums opacity-70">{o.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
