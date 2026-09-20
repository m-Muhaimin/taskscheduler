import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkspaceOnboardingClient } from "./workspace-onboarding-client";

export const metadata: Metadata = { title: "Set up your workspace | Ridgeline" };

export default function WorkspaceOnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <WorkspaceOnboardingClient />
    </Suspense>
  );
}
