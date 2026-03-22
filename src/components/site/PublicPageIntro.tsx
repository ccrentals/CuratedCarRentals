import type { ReactNode } from "react";

import { Container } from "@/components/site/Container";
import { Button, type ButtonVariant } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type PublicAction = {
  href: string;
  label: string;
  variant?: ButtonVariant;
  className?: string;
};

type PublicPageIntroProps = {
  eyebrow?: string;
  title: string;
  description: string;
  primaryAction?: PublicAction;
  secondaryAction?: PublicAction;
  children?: ReactNode;
  className?: string;
  align?: "left" | "center";
};

export function PublicPageIntro({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
  children,
  className,
  align = "left",
}: PublicPageIntroProps) {
  const centered = align === "center";

  return (
    <section className={cn("relative overflow-hidden border-b border-[var(--ccr-border)] bg-[var(--ccr-primary)] text-white", className)}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(255,207,109,0.18),transparent_38%)]" />
      <Container className="relative py-16 md:py-24">
        <div className={cn("max-w-3xl", centered && "mx-auto text-center")}>
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[var(--ccr-accent)]">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white md:text-6xl">
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-white/78 md:text-lg">
            {description}
          </p>
          {children ? <div className="mt-8">{children}</div> : null}
          {primaryAction || secondaryAction ? (
            <div className={cn("mt-8 flex flex-wrap gap-3", centered && "justify-center")}>
              {primaryAction ? (
                <Button
                  href={primaryAction.href}
                  className={cn(
                    "bg-[var(--ccr-accent)] text-[var(--ccr-primary)] hover:bg-[#ffd588]",
                    primaryAction.className,
                  )}
                  variant={primaryAction.variant ?? "primary"}
                >
                  {primaryAction.label}
                </Button>
              ) : null}
              {secondaryAction ? (
                <Button
                  href={secondaryAction.href}
                  variant={secondaryAction.variant ?? "outline"}
                  className={cn(
                    "border-white/20 bg-white/6 text-white hover:bg-white/12",
                    secondaryAction.className,
                  )}
                >
                  {secondaryAction.label}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </Container>
    </section>
  );
}
