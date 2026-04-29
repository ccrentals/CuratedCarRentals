import { AuthPageShell } from "@/components/security/AuthPageShell";
import { ClerkAccountSetupForm } from "@/components/security/ClerkAccountSetupForm";
import { ClerkInvitationSignUpForm } from "@/components/security/ClerkInvitationSignUpForm";
import { loadPostClerkAdminAuthPath } from "@/lib/auth/adminLoginMethod";
import { isClerkPublishableKeyConfigured } from "@/lib/security/clerk";

function resolveRedirectUrl(
  value: string | string[] | undefined,
  fallback: string,
) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  try {
    const decoded = decodeURIComponent(value);
    return decoded.startsWith("/") ? decoded : fallback;
  } catch {
    return value.startsWith("/") ? value : fallback;
  }
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[]; __clerk_ticket?: string | string[] }>;
}) {
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

  const [fallbackRedirectUrl, params] = await Promise.all([
    loadPostClerkAdminAuthPath(),
    searchParams,
  ]);
  const redirectUrlComplete = resolveRedirectUrl(params.redirect, fallbackRedirectUrl);
  const invitationTicket =
    typeof params.__clerk_ticket === "string" && params.__clerk_ticket.trim()
      ? params.__clerk_ticket.trim()
      : null;

  return (
    <AuthPageShell>
      <div className="mx-auto max-w-md">
        {invitationTicket ? (
          <ClerkInvitationSignUpForm
            invitationTicket={invitationTicket}
            redirectUrlComplete={redirectUrlComplete}
          />
        ) : (
          <ClerkAccountSetupForm redirectUrlComplete={redirectUrlComplete} />
        )}
      </div>
    </AuthPageShell>
  );
}
