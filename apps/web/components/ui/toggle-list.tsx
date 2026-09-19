"use client";

import { useId, useState } from "react";
import clsx from "clsx";
import { Switch } from "./switch";

export interface ToggleRow {
  id: string;
  title: string;
  description: string;
  defaultOn: boolean;
}

interface ToggleListProps {
  rows: readonly ToggleRow[];
  onToggle?: (row: ToggleRow, next: boolean) => void;
  className?: string;
  /**
   * CONTROLLED mode (T11): when provided, the Switch reads `on` from these
   * values and `onToggle` is the ONLY writer — no internal setState. Missing
   * keys fall back to the row's defaultOn so partial records don't glitch.
   * When omitted, the list stays fully uncontrolled (internal state seeded
   * from defaultOn) — the landing page "Your rules" section relies on that.
   */
  values?: Record<string, boolean>;
}

/**
 * Settings-style list of switches. The dashboard Settings page and the landing
 * page's "Your rules" section render this exact component.
 */
export function ToggleList({ rows, onToggle, className, values }: ToggleListProps) {
  const base = useId();
  const [state, setState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.defaultOn]))
  );

  return (
    <ul className={clsx("card divided overflow-hidden", className)}>
      {rows.map((row) => {
        const switchId = `${base}-${row.id}`;
        const on = values ? (values[row.id] ?? row.defaultOn) : state[row.id];
        return (
          <li key={row.id} className="transition-colors hover:bg-surface-2/60">
            {/* the label makes the whole row a click target for the switch */}
            <label htmlFor={switchId} className="flex items-center justify-between gap-4 p-4 cursor-pointer">
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium">{row.title}</span>
                <span className="block text-[12.5px] leading-[1.5] text-ink-muted mt-0.5">{row.description}</span>
              </span>
              <Switch
                id={switchId}
                on={on}
                label={row.title}
                onChange={(next) => {
                  if (values) {
                    // Controlled: the parent owns the value — just notify it.
                    onToggle?.(row, next);
                  } else {
                    setState((s) => ({ ...s, [row.id]: next }));
                    onToggle?.(row, next);
                  }
                }}
              />
            </label>
          </li>
        );
      })}
    </ul>
  );
}
