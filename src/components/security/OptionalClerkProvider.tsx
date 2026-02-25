import { ClerkProvider } from "@clerk/nextjs";

import { ClerkSessionTaskGate } from "@/components/security/ClerkSessionTaskGate";
import { isClerkPublishableKeyConfigured } from "@/lib/security/clerk";

const clerkAppearance = {
  variables: {
    colorPrimary: "var(--ccr-primary)",
    colorBackground: "var(--ccr-clerk-surface)",
    colorInputBackground: "var(--ccr-clerk-input-bg)",
    colorInputText: "var(--ccr-clerk-text)",
    colorText: "var(--ccr-clerk-text)",
    colorTextSecondary: "var(--ccr-clerk-muted)",
    colorNeutral: "var(--ccr-clerk-muted)",
    colorDanger: "var(--ccr-clerk-danger-text)",
    borderRadius: "0.75rem",
    fontFamily: "var(--font-geist-sans)",
  },
  elements: {
    cardBox: {
      padding: "0.25rem",
    },
    card: {
      backgroundColor: "color-mix(in srgb, var(--ccr-clerk-surface) 96%, #ffffff 4%)",
      border: "1px solid color-mix(in srgb, var(--ccr-clerk-border) 88%, #ffffff 12%)",
      boxShadow: "0 22px 48px rgba(3, 7, 15, 0.55)",
    },
    headerTitle: { color: "var(--ccr-clerk-text)" },
    headerSubtitle: { color: "var(--ccr-clerk-muted)" },
    formFieldLabel: { color: "var(--ccr-clerk-muted)" },
    formFieldInput: {
      backgroundColor: "var(--ccr-clerk-input-bg)",
      borderColor: "var(--ccr-clerk-border)",
      color: "var(--ccr-clerk-text)",
    },
    socialButtonsBlockButton: {
      backgroundColor: "#ffffff",
      color: "#111827",
      borderColor: "color-mix(in srgb, var(--ccr-clerk-border) 85%, #ffffff 15%)",
    },
    socialButtonsIconButton: {
      backgroundColor: "#ffffff",
      color: "#111827",
      borderColor: "color-mix(in srgb, var(--ccr-clerk-border) 85%, #ffffff 15%)",
    },
    formButtonPrimary: {
      backgroundColor: "var(--ccr-primary)",
      color: "#ffffff",
      boxShadow: "0 8px 18px color-mix(in srgb, var(--ccr-primary) 52%, transparent)",
    },
    alert: {
      backgroundColor: "var(--ccr-clerk-danger-bg)",
      borderColor: "var(--ccr-clerk-danger-border)",
    },
    alertText: { color: "var(--ccr-clerk-danger-text)" },
    alertIcon: { color: "var(--ccr-clerk-danger-text)" },
    formFieldErrorText: { color: "var(--ccr-clerk-danger-text)" },
  },
} as const;

export function OptionalClerkProvider({ children }: { children: React.ReactNode }) {
  if (!isClerkPublishableKeyConfigured()) {
    return <>{children}</>;
  }

  return (
    <ClerkProvider
      signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in"}
      signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up"}
      appearance={clerkAppearance}
      taskUrls={{
        "reset-password": "/task/reset-password",
      }}
    >
      <ClerkSessionTaskGate />
      {children}
    </ClerkProvider>
  );
}
