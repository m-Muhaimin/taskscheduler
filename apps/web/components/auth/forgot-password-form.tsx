"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { requestPasswordReset } from "@/lib/auth";
import { validateEmail } from "@/lib/validation";
import { TextField } from "./text-field";
import { SubmitButton } from "./submit-button";
import { FormAlert } from "./form-alert";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputWrapRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (sentTo) headingRef.current?.focus();
  }, [sentTo]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;

    const problem = validateEmail(email);
    setError(problem);
    setFormError(null);
    if (problem) {
      inputWrapRef.current?.querySelector<HTMLInputElement>('[name="email"]')?.focus();
      return;
    }

    setLoading(true);
    try {
      await requestPasswordReset({ email });
      setSentTo(email.trim());
    } catch {
      setFormError("We couldn\u2019t send that email. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sentTo) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-start gap-3 p-4 rounded-[10px] border border-border-strong bg-bg">
          <MailCheck size={20} className="shrink-0 mt-1" style={{ color: "var(--success)" }} aria-hidden="true" />
          <div>
            <h2 ref={headingRef} tabIndex={-1} className="font-head font-semibold text-[18px] leading-tight">
              Check your email
            </h2>
            <p className="text-[14px] leading-[1.55] mt-2">
              If an account exists for <span className="font-medium break-all">{sentTo}</span>, a reset link is on its
              way. It can take a minute to arrive.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost w-full"
          onClick={() => {
            setSentTo(null);
            setEmail("");
          }}
        >
          Use a different email
        </button>
        <Link href="/login" className="btn btn-primary w-full">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form ref={inputWrapRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      {formError && <FormAlert message={formError} />}
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@yourshop.com"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (error) setError(undefined);
        }}
        error={error}
        disabled={loading}
      />
      <SubmitButton loading={loading} loadingLabel="Sending link">
        Send reset link
      </SubmitButton>
    </form>
  );
}
