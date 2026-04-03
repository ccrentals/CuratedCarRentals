import type { ReactNode } from "react";

import { Container } from "@/components/site/Container";
import { cn } from "@/lib/utils";

type PublicSectionProps = {
  eyebrow?: string;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function PublicSection({
  eyebrow,
  title,
  description,
  children,
  className,
  contentClassName,
}: PublicSectionProps) {
  return (
    <section className={cn("py-12 sm:py-14 md:py-24", className)}>
      <Container>
        {eyebrow || title || description ? (
          <div className="max-w-3xl">
            {eyebrow ? (
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <h2 className="mt-3 text-[2rem] font-semibold leading-tight tracking-tight text-[var(--ccr-light-surface-text)] sm:text-[2.2rem] md:text-5xl">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-4 text-[0.98rem] leading-7 text-[var(--ccr-light-surface-muted)] sm:text-base md:text-lg">
                {description}
              </p>
            ) : null}
          </div>
        ) : null}
        <div
          className={cn(
            (eyebrow || title || description) && "mt-8 sm:mt-10 md:mt-12",
            contentClassName,
          )}
        >
          {children}
        </div>
      </Container>
    </section>
  );
}
