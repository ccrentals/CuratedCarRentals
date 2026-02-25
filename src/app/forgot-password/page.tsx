import { AuthPageShell } from "@/components/security/AuthPageShell";
import { ForgotPasswordForm } from "@/components/security/ForgotPasswordForm";
import { isClerkPublishableKeyConfigured } from "@/lib/security/clerk";

export default function ForgotPasswordPage() {
  if (!isClerkPublishableKeyConfigured()) {
    return (
      <AuthPageShell>
        <div className="mx-auto max-w-xl rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 text-sm text-[var(--ccr-muted)]">
          Clerk is not configured yet. Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
          `CLERK_SECRET_KEY` to enable password reset.
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell>
      <div className="mx-auto flex max-w-md justify-center">
        <ForgotPasswordForm />
      </div>
    </AuthPageShell>
  );
}
