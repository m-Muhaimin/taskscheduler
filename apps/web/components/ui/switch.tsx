"use client";

interface SwitchProps {
  on: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name. */
  label: string;
  id?: string;
}

/** Accessible on/off switch. A real <button role="switch"> so Space/Enter work natively. */
export function Switch({ on, onChange, label, id }: SwitchProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="switch"
      data-on={on}
      onClick={() => onChange(!on)}
    >
      <span className="knob" />
    </button>
  );
}
