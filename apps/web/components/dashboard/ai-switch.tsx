"use client";

interface AiSwitchProps {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
}

export function AiSwitch({ on, onChange, label }: AiSwitchProps) {
  return (
    <div
      role="switch"
      aria-checked={on}
      aria-label={label}
      tabIndex={0}
      className="ai-switch"
      data-on={on}
      onClick={() => onChange(!on)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onChange(!on);
        }
      }}
    >
      <div className="knob" />
    </div>
  );
}
