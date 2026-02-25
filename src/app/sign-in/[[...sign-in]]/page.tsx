import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

import { AuthPageShell } from "@/components/security/AuthPageShell";
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

export default function SignInPage() {
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
            fallbackRedirectUrl="/admin"
            appearance={signInAppearance}
          />
        </div>
        <div className={`mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 ${styles.authActions}`}>
          <Link href="/" className={styles.authActionButton}>
            Back to Home
          </Link>
          <Link href="/book" className={styles.authActionButton}>
            Book Now
          </Link>
        </div>
      </div>
    </AuthPageShell>
  );
}
