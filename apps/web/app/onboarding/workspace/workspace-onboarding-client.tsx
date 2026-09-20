"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { WorkspaceSetupForm } from "@/components/onboarding/workspace-setup-form";
import { getWorkspaceStatus, WORKSPACE_SESSION_EXPIRED } from "@/lib/workspace-api";

export function WorkspaceOnboardingClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultName = searchParams.get("business") ?? "";

  // Starts true even though signup already knows this user has no org yet —
  // this same page is also where resolvePostAuthPath() from *login* lands,
  // and where anyone who bookmarks/back-buttons their way here ends up, so
  // it always re-checks rather than trusting how it was navigated to.
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getWorkspaceStatus()
      .then((status) => {
        if (cancelled) return;
        if (status === WORKSPACE_SESSION_EXPIRED) return; // redirect to /login in flight
        if (status.hasOrganization) {
          router.replace("/dashboard");
          return;
        }
        setChecking(false);
      })
      .catch(() => {
        // A network hiccup on the status check shouldn't trap a brand-new
        // user on a blank spinner — fall through to the form. The one-
        // workspace-per-user rule is still enforced server-side either way.
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (checking) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <span
          aria-hidden="true"
          className="w-5 h-5 rounded-full border-2 border-current border-t-transparent animate-spin text-ink-faint"
        />
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col px-5 md:px-10 py-4">
      <header className="flex items-center justify-between">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="animate-rise flex-1 flex flex-col justify-center w-full max-w-[380px] mx-auto py-8">
        <h1 className="h-page">Set up your workspace</h1>
        <p className="text-ink-muted text-[14px] leading-[1.55] mt-2 mb-6">
          One more step — name your business and the AI can start answering the phone.
        </p>
        <WorkspaceSetupForm defaultName={defaultName} />
      </main>
    </div>
  );
}
