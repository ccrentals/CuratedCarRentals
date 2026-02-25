import { AuthPageShell } from "@/components/security/AuthPageShell";
import { ClerkAccountSetupForm } from "@/components/security/ClerkAccountSetupForm";
import { isClerkPublishableKeyConfigured } from "@/lib/security/clerk";

export default function SignUpPage() {
  if (!isClerkPublishableKeyConfigured()) {
    return (
      <AuthPageShell>
        <div className="mx-auto max-w-xl rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 text-sm text-[var(--ccr-muted)]">
          Clerk is not configured yet. Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
          `CLERK_SECRET_KEY` to enable sign up.
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell>
      <div className="mx-auto max-w-md">
        <ClerkAccountSetupForm />
      </div>
    </AuthPageShell>
  );
}
