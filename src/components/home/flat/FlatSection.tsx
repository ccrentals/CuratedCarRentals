import type { ReactNode } from "react";

import { Container } from "@/components/site/Container";
import { cn } from "@/lib/utils";

type FlatSectionProps = {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
};

export function FlatSection({ title, subtitle, children, className }: FlatSectionProps) {
  return (
    <section className={cn("py-8 md:py-10 lg:py-12", className)}>
      <Container>
        <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 sm:p-6 lg:p-8">
          {title || subtitle ? (
            <header className="mb-6 border-b border-[var(--ccr-border)] pb-4 sm:mb-8 sm:pb-5">
              {title ? <h2 className="text-2xl font-extrabold tracking-tight text-[var(--ccr-text)] sm:text-3xl">{title}</h2> : null}
              {subtitle ? <p className="mt-2 text-sm text-[var(--ccr-muted)] sm:text-base">{subtitle}</p> : null}
            </header>
          ) : null}
          {children}
        </div>
      </Container>
    </section>
  );
}
