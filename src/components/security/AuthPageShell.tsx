import type { ReactNode } from "react";

type AuthPageShellProps = {
  children: ReactNode;
};

export function AuthPageShell({ children }: AuthPageShellProps) {
  return (
    <section className="relative min-h-screen overflow-hidden bg-[var(--ccr-bg)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute inset-0 bg-[var(--ccr-bg)]" />
        <div className="ccr-auth-radial-wash absolute inset-0" />
        <div className="ccr-auth-linear-wash absolute inset-0" />
      </div>
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center justify-center">
        <div
          className="ccr-auth-card-glow pointer-events-none absolute -inset-x-5 -inset-y-8 rounded-[2rem] blur-3xl"
          aria-hidden="true"
        />
        <div className="w-full">{children}</div>
      </div>
    </section>
  );
}
