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
    <section className={cn("py-16 md:py-24", className)}>
      <Container>
        {eyebrow || title || description ? (
          <div className="max-w-3xl">
            {eyebrow ? (
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--ccr-text)] md:text-5xl">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-4 text-base leading-7 text-[var(--ccr-muted)] md:text-lg">{description}</p>
            ) : null}
          </div>
        ) : null}
        <div className={cn((eyebrow || title || description) && "mt-10 md:mt-12", contentClassName)}>{children}</div>
      </Container>
    </section>
  );
}
