"use client";

import { useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className" | "aria-invalid" | "aria-describedby"> {
  label: string;
  error?: string;
  hint?: string;
  /** Sits on the label row, right-aligned (e.g. a "Forgot password?" link). */
  labelAside?: ReactNode;
}

export function TextField({ label, error, hint, labelAside, ...input }: TextFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const hasMessage = Boolean(error || hint);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 mb-1.5">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
        {labelAside}
      </div>
      <input
        {...input}
        id={id}
        className="field"
        aria-invalid={error ? true : undefined}
        aria-describedby={hasMessage ? messageId : undefined}
      />
      {hasMessage && (
        <p
          id={messageId}
          className="animate-rise mt-1.5 text-[12.5px] leading-snug"
          style={{ color: error ? "var(--danger)" : "var(--ink-muted)" }}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
