"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthError, signUp } from "@/lib/auth";
import {
  MIN_PASSWORD_LENGTH,
  validateEmail,
  validatePassword,
  validateRequired,
} from "@/lib/validation";
import { TextField } from "./text-field";
import { PasswordField } from "./password-field";
import { SubmitButton } from "./submit-button";
import { FormAlert } from "./form-alert";

type FieldName = "name" | "email" | "password";
type Errors = Partial<Record<FieldName, string>>;

const FIELD_ORDER: FieldName[] = ["name", "email", "password"];

export function SignupForm() {
  const router = useRouter();
  const [values, setValues] = useState<Record<FieldName, string>>({
    name: "",
    email: "",
    password: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function set(field: FieldName) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setValues((s) => ({ ...s, [field]: value }));
      if (errors[field]) setErrors((s) => ({ ...s, [field]: undefined }));
    };
  }

  function focusField(field: FieldName) {
    formRef.current?.querySelector<HTMLInputElement>(`[name="${field}"]`)?.focus();
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;

    const next: Errors = {
      name: validateRequired(values.name, "Enter your name."),
      email: validateEmail(values.email),
      password: validatePassword(values.password, "signup"),
    };
    setErrors(next);
    setFormError(null);

    const firstInvalid = FIELD_ORDER.find((f) => next[f]);
    if (firstInvalid) {
      focusField(firstInvalid);
      return;
    }

    setLoading(true);
    try {
      await signUp(values);
      router.push("/dashboard");
    } catch (err) {
      if (err instanceof AuthError && err.field) {
        setErrors({ email: err.message });
        focusField(err.field);
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
        label="Your name"
        name="name"
        autoComplete="name"
        value={values.name}
        onChange={set("name")}
        error={errors.name}
        disabled={loading}
      />
      <TextField
        label="Work email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        value={values.email}
        onChange={set("email")}
        error={errors.email}
        disabled={loading}
      />
      <PasswordField
        label="Password"
        name="password"
        autoComplete="new-password"
        value={values.password}
        onChange={set("password")}
        error={errors.password}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        disabled={loading}
      />
      <SubmitButton loading={loading} loadingLabel="Creating account">
        Create account
      </SubmitButton>
    </form>
  );
}
