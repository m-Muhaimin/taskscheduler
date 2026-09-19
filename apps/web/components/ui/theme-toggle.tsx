"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

/**
 * Light/dark toggle, shared by dashboard, landing and auth.
 * The initial theme is applied before paint by the inline script in app/layout.tsx,
 * and the icon swap is pure CSS keyed off <html data-theme>, so there is no flash.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    setTheme(attr === "dark" ? "dark" : attr === "light" ? "light" : null);
  }, []);

  function toggle() {
    const current =
      (document.documentElement.getAttribute("data-theme") as Theme | null) ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next: Theme = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    setTheme(next);
    try {
      window.localStorage.setItem("rl-theme", next);
    } catch {
      // storage unavailable: the theme just won't persist across visits
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle color theme"
      aria-pressed={theme === null ? undefined : theme === "dark"}
      className="icon-btn theme-toggle"
    >
      <Sun size={16} className="sun" aria-hidden="true" />
      <Moon size={16} className="moon" aria-hidden="true" />
    </button>
  );
}
