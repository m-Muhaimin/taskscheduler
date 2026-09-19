"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useEscape, useScrollSpy, useScrolled } from "@/lib/hooks";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#handoff", label: "Emergencies" },
  { href: "#faq", label: "FAQ" },
] as const;

const SECTION_IDS = LINKS.map((l) => l.href.slice(1));

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const scrolled = useScrolled();
  const active = useScrollSpy(SECTION_IDS);
  useEscape(() => setOpen(false), open);

  return (
    <header className="site-header" data-scrolled={scrolled}>
      <div className="container-x h-14 flex items-center gap-6">
        <Logo />

        <nav aria-label="Primary" className="hidden md:flex items-center gap-1">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="nav-link" data-active={active === l.href.slice(1)}>
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Link href="/login" className="btn btn-ghost btn-sm hidden sm:inline-flex">
            Sign in
          </Link>
          <Link href="/signup" className="btn btn-primary btn-sm">
            Get started
          </Link>
          <button
            type="button"
            className="icon-btn swap-icon md:hidden"
            data-on={open}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
          >
            <Menu size={18} />
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Mobile menu: same expandable primitive the FAQ and dashboard banner use */}
      <div id="mobile-menu" className="expandable md:hidden" data-collapsed={!open}>
        <div className="expandable-inner">
          <nav aria-label="Mobile" className="container-x flex flex-col gap-1 pb-3 pt-1">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="nav-link !h-10 !text-[14px]"
                data-active={active === l.href.slice(1)}
              >
                {l.label}
              </a>
            ))}
            <Link href="/login" onClick={() => setOpen(false)} className="nav-link !h-10 !text-[14px] sm:hidden">
              Sign in
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
