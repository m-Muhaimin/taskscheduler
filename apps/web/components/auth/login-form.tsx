"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthError, signIn } from "@/lib/auth";
import { validateEmail, validatePassword } from "@/lib/validation";
import { TextField } from "./text-field";
import { PasswordField } from "./password-field";
import { SubmitButton } from "./submit-button";
import { FormAlert } from "./form-alert";

interface Errors {
  email?: string;
  password?: string;
}

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;

    const next: Errors = {
      email: validateEmail(email),
      password: validatePassword(password, "login"),
    };
    setErrors(next);
    setFormError(null);

    if (next.email || next.password) {
      const firstInvalid = next.email ? "email" : "password";
      formRef.current?.querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }

    setLoading(true);
    try {
      await signIn({ email, password });
      router.push("/dashboard");
    } catch (err) {
      if (err instanceof AuthError && err.field) {
        setErrors(err.field === "email" ? { email: err.message } : { password: err.message });
      } else {
        setFormError(err instanceof AuthError ? err.message : "Something went wrong on our end. Try again in a moment.");
      }
      setLoading(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
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
          if (errors.email) setErrors((s) => ({ ...s, email: undefined }));
        }}
        error={errors.email}
        disabled={loading}
      />
      <PasswordField
        label="Password"
        name="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          if (errors.password) setErrors((s) => ({ ...s, password: undefined }));
        }}
        error={errors.password}
        disabled={loading}
        labelAside={
          <Link href="/forgot-password" className="link text-[13px]">
            Forgot password?
          </Link>
        }
      />
      <SubmitButton loading={loading} loadingLabel="Signing in">
        Sign in
      </SubmitButton>
    </form>
  );
}
