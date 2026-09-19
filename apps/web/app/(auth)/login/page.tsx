import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in | Ridgeline" };

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in"
      subtitle="Pick up where the front desk left off."
      asideHeading="Here is what the front desk handled overnight."
      footer={
        <p>
          New to Ridgeline?{" "}
          <Link href="/signup" className="link">
            Create an account
          </Link>
        </p>
      }
    >
      <LoginForm />
    </AuthShell>
  );
}
