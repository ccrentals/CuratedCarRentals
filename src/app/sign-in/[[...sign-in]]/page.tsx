import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthPageShell } from "@/components/security/AuthPageShell";
import { SignInIdentifierHint } from "@/components/security/SignInIdentifierHint";
import {
  loadPostClerkAdminAuthPath,
  loadPrimaryAdminLoginMethod,
} from "@/lib/auth/adminLoginMethod";
import { isClerkPublishableKeyConfigured } from "@/lib/security/clerk";
import styles from "./sign-in.module.css";

const signInAppearance = {
  // Keep SSO visible, but remove sign-up footer copy from the sign-in card.
  elements: {
    footerAction: { display: "none" },
    // Sign-in should be email-first during migration; hide the phone-method switcher in this view.
    formFieldAction__identifier: { display: "none" },
  },
} as const;

function shouldHideSiteActions(params: {
  [key: string]: string | string[] | undefined;
}) {
  const redirect = params.redirect;
  if (typeof redirect === "string" && redirect.startsWith("/admin")) {
    return true;
  }

  const redirectUrl = params.redirect_url;
  if (typeof redirectUrl === "string") {
    try {
      if (redirectUrl.startsWith("http://") || redirectUrl.startsWith("https://")) {
        return new URL(redirectUrl).pathname.startsWith("/admin");
      }
      return redirectUrl.startsWith("/admin");
    } catch {
      return redirectUrl.includes("/admin");
    }
  }

  return false;
}

function buildAdminAuthEntryHref(params: {
  [key: string]: string | string[] | undefined;
}) {
  const query = new URLSearchParams();

  const redirectValue = params.redirect;
  if (typeof redirectValue === "string" && redirectValue.startsWith("/")) {
    query.set("redirect", redirectValue);
  }

  const redirectUrlValue = params.redirect_url;
  if (!query.has("redirect") && typeof redirectUrlValue === "string") {
    try {
      const pathname =
        redirectUrlValue.startsWith("http://") || redirectUrlValue.startsWith("https://")
          ? new URL(redirectUrlValue).pathname
          : redirectUrlValue;
      if (pathname.startsWith("/")) {
        query.set("redirect", pathname);
      }
    } catch {
      if (redirectUrlValue.startsWith("/")) {
        query.set("redirect", redirectUrlValue);
      }
    }
  }

  const queryString = query.toString();
  return queryString ? `/admin/auth?${queryString}` : "/admin/auth";
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const primaryAdminLoginMethod = await loadPrimaryAdminLoginMethod();
  if (primaryAdminLoginMethod !== "clerk") {
    redirect(buildAdminAuthEntryHref(params));
  }

  const postClerkAdminAuthPath = await loadPostClerkAdminAuthPath();
  const hideSiteActions = shouldHideSiteActions(params);
  const showAuxiliaryAuthUi = !hideSiteActions;

  if (!isClerkPublishableKeyConfigured()) {
    return (
      <AuthPageShell>
        <div className="mx-auto max-w-xl rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 text-sm text-[var(--ccr-muted)]">
          Clerk is not configured yet. Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
          `CLERK_SECRET_KEY` to enable sign in.
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell>
      <div className={`mx-auto max-w-md ${styles.signInRoot}`}>
        <div className="flex justify-center">
          <SignIn
            path="/sign-in"
            routing="path"
            withSignUp={false}
            transferable={false}
            fallbackRedirectUrl={postClerkAdminAuthPath}
            appearance={signInAppearance}
          />
        </div>
        {showAuxiliaryAuthUi ? <SignInIdentifierHint /> : null}
        {showAuxiliaryAuthUi ? (
          <div className={`mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 ${styles.authActions}`}>
            <Link href="/" className={styles.authActionButton}>
              Back to Home
            </Link>
            <Link href="/book" className={styles.authActionButton}>
              Book Now
            </Link>
          </div>
        ) : null}
      </div>
    </AuthPageShell>
  );
}
