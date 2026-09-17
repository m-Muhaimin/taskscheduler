"use client"

import { useEffect, useState } from "react"

/** Client-only matchMedia hook; first render assumes false (SSR-safe). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(query)
    setMatches(mql.matches)
    const onChange = () => setMatches(mql.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [query])

  return matches
}

/** `lg` breakpoint (1024px) — where the sidebar shell kicks in (brief §4.0). */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)")
}