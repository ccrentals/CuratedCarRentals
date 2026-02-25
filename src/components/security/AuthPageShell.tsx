import type { ReactNode } from "react";

type AuthPageShellProps = {
  children: ReactNode;
};

export function AuthPageShell({ children }: AuthPageShellProps) {
  return (
    <section className="relative min-h-screen overflow-hidden bg-[var(--ccr-bg)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute inset-0 bg-[var(--ccr-bg)]" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(72rem 44rem at 50% -10%, color-mix(in srgb, var(--ccr-surface-soft) 76%, transparent), transparent)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--ccr-bg) 90%, var(--ccr-primary) 10%) 0%, var(--ccr-bg) 100%)",
          }}
        />
      </div>
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center justify-center">
        <div
          className="pointer-events-none absolute -inset-x-5 -inset-y-8 rounded-[2rem] blur-3xl"
          style={{
            background:
              "radial-gradient(60% 55% at 50% 45%, color-mix(in srgb, var(--ccr-clerk-surface) 36%, transparent), transparent)",
          }}
          aria-hidden="true"
        />
        <div className="w-full">{children}</div>
      </div>
    </section>
  );
}
