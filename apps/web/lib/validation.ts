const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const MIN_PASSWORD_LENGTH = 8;

export function validateEmail(value: string): string | undefined {
  const v = value.trim();
  if (!v) return "Enter your email address.";
  if (!EMAIL_RE.test(v)) return "That doesn\u2019t look like an email address.";
  return undefined;
}

export function validatePassword(value: string, mode: "login" | "signup"): string | undefined {
  if (!value) return "Enter your password.";
  if (mode === "signup" && value.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return undefined;
}

export function validateRequired(value: string, message: string): string | undefined {
  return value.trim() ? undefined : message;
}
