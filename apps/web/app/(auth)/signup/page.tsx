import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata: Metadata = { title: "Create your account | Ridgeline" };

export default function SignupPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="Set up your shop and let the AI start answering the phone."
      asideHeading="Tomorrow morning, this could be your log."
      footer={
        <p>
          Already have an account?{" "}
          <Link href="/login" className="link">
            Sign in
          </Link>
        </p>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
