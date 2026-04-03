import { AuthPageShell } from "@/components/security/AuthPageShell";
import { ClerkTaskResetPasswordForm } from "@/components/security/ClerkTaskResetPasswordForm";
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

export default async function ResetPasswordTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
}) {
  if (!isClerkPublishableKeyConfigured()) {
    return (
      <AuthPageShell>
        <div className="mx-auto max-w-xl rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 text-sm text-[var(--ccr-muted)]">
          Clerk is not configured yet. Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
          `CLERK_SECRET_KEY` to enable password reset tasks.
        </div>
      </AuthPageShell>
    );
  }

  const [fallbackRedirectUrl, params] = await Promise.all([
    loadPostClerkAdminAuthPath(),
    searchParams,
  ]);
  const redirectUrlComplete = resolveRedirectUrl(params.redirect_url, fallbackRedirectUrl);

  return (
    <AuthPageShell>
      <div className="mx-auto flex max-w-md justify-center">
        <ClerkTaskResetPasswordForm redirectUrlComplete={redirectUrlComplete} />
      </div>
    </AuthPageShell>
  );
}
