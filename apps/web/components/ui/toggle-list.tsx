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
}

/**
 * Settings-style list of switches. The dashboard Settings page and the landing
 * page's "Your rules" section render this exact component.
 */
export function ToggleList({ rows, onToggle, className }: ToggleListProps) {
  const base = useId();
  const [state, setState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.defaultOn]))
  );

  return (
    <ul className={clsx("card divided overflow-hidden", className)}>
      {rows.map((row) => {
        const switchId = `${base}-${row.id}`;
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
                on={state[row.id]}
                label={row.title}
                onChange={(next) => {
                  setState((s) => ({ ...s, [row.id]: next }));
                  onToggle?.(row, next);
                }}
              />
            </label>
          </li>
        );
      })}
    </ul>
  );
}
