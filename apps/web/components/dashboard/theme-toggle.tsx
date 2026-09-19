"use client";

import { useEffect, useState } from "react";
import { Sun } from "lucide-react";

export function ThemeToggle({ large = false }: { large?: boolean }) {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("rl-theme") as "light" | "dark" | null;
      if (saved) {
        document.documentElement.setAttribute("data-theme", saved);
        setTheme(saved);
      }
    } catch {
      // localStorage unavailable — fall back to prefers-color-scheme only
    }
  }, []);

  function toggle() {
    const isDark =
      theme === "dark" ||
      (theme === null && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    setTheme(next);
    try {
      window.localStorage.setItem("rl-theme", next);
    } catch {
      // ignore write failure, theme just won't persist across visits
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle color theme"
      className={`${large ? "w-11 h-11 rounded-[10px] border-field" : "w-9 h-9 rounded-[9px] border-border-strong"} border flex items-center justify-center hover:bg-surface-2 transition-colors`}
    >
      <Sun
        size={16}
        className="transition-transform duration-500"
        style={{ transform: theme === "dark" ? "rotate(40deg)" : "rotate(0deg)" }}
      />
    </button>
  );
}
