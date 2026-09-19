"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

type Tone = "default" | "success" | "danger";

interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
  leaving: boolean;
}

interface ToastApi {
  push: (message: string, opts?: { tone?: Tone; durationMs?: number }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Safe outside a provider (no-op), so shared components can call it anywhere. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? { push: () => {} };
}

const ICONS = { default: Info, success: CheckCircle2, danger: AlertTriangle } as const;
const ICON_COLOR: Record<Tone, string> = {
  default: "var(--ink-muted)",
  success: "var(--success)",
  danger: "var(--danger)",
};

const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((t) => window.clearTimeout(t));
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    timers.current.push(
      window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 200)
    );
  }, []);

  const push = useCallback<ToastApi["push"]>(
    (message, opts) => {
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), { id, message, tone: opts?.tone ?? "default", leaving: false }]);
      timers.current.push(window.setTimeout(() => dismiss(id), opts?.durationMs ?? 3200));
    },
    [dismiss]
  );

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport" role="status" aria-live="polite" aria-atomic="false">
        {items.map((t) => {
          const Icon = ICONS[t.tone];
          return (
            <div key={t.id} className="toast" data-leaving={t.leaving}>
              <Icon size={16} className="shrink-0" style={{ color: ICON_COLOR[t.tone] }} aria-hidden="true" />
              <span>{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
