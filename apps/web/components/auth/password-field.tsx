"use client";

import { useId, useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";

interface PasswordFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "id" | "className" | "type" | "aria-invalid" | "aria-describedby"
  > {
  label: string;
  error?: string;
  hint?: string;
  labelAside?: ReactNode;
}

export function PasswordField({ label, error, hint, labelAside, ...input }: PasswordFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const [visible, setVisible] = useState(false);
  const hasMessage = Boolean(error || hint);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <label htmlFor={id} className="text-[14px] font-medium">
          {label}
        </label>
        {labelAside}
      </div>
      <div className="relative">
        <input
          {...input}
          id={id}
          type={visible ? "text" : "password"}
          className="field pr-12"
          aria-invalid={error ? true : undefined}
          aria-describedby={hasMessage ? messageId : undefined}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute right-0 top-0 h-11 w-11 flex items-center justify-center rounded-[10px] text-ink-muted hover:text-ink transition-colors"
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      {hasMessage && (
        <p
          id={messageId}
          className="mt-2 text-[13px] leading-snug"
          style={{ color: error ? "var(--danger)" : "var(--ink-muted)" }}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
