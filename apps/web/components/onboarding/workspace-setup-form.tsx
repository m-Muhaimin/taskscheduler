"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createWorkspace, WorkspaceApiError } from "@/lib/workspace-api";
import { validateRequired } from "@/lib/validation";
import { TextField } from "@/components/auth/text-field";
import { SubmitButton } from "@/components/auth/submit-button";
import { FormAlert } from "@/components/auth/form-alert";

interface WorkspaceSetupFormProps {
  /** Prefilled from the business name collected at signup, if any. */
  defaultName?: string;
}

export function WorkspaceSetupForm({ defaultName = "" }: WorkspaceSetupFormProps) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function focusName() {
    formRef.current?.querySelector<HTMLInputElement>('[name="name"]')?.focus();
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;

    const nameError = validateRequired(name, "Enter your business name.");
    setError(nameError);
    setFormError(null);
    if (nameError) {
      focusName();
      return;
    }

    setLoading(true);
    try {
      // Auto-detected rather than asked: scheduling correctness depends on
      // it, but a timezone picker is one more decision a brand-new user
      // doesn't need — this can move into Settings later if it's ever wrong.
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await createWorkspace({ name: name.trim(), timezone });
      router.push("/dashboard");
    } catch (err) {
      if (err instanceof WorkspaceApiError && err.code === "already_has_organization") {
        // Shouldn't normally be reachable (the page redirects away first if
        // the status check says so) but if it happens, the right place is
        // the dashboard, not a dead-end error.
        router.push("/dashboard");
        return;
      }
      setFormError(err instanceof WorkspaceApiError ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && <FormAlert message={formError} />}
      <TextField
        label="Business name"
        name="name"
        autoComplete="organization"
        autoFocus
        placeholder="e.g. Ridgeline Plumbing & HVAC"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (error) setError(undefined);
        }}
        error={error}
        disabled={loading}
      />
      <SubmitButton loading={loading} loadingLabel="Setting up your workspace">
        Continue to dashboard
      </SubmitButton>
    </form>
  );
}
