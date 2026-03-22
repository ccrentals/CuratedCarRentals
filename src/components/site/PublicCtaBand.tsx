import { Button, type ButtonVariant } from "@/components/ui/Button";

import { Container } from "@/components/site/Container";

type Action = {
  href: string;
  label: string;
  variant?: ButtonVariant;
  className?: string;
};

type PublicCtaBandProps = {
  eyebrow?: string;
  title: string;
  description: string;
  primaryAction: Action;
  secondaryAction?: Action;
};

export function PublicCtaBand({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
}: PublicCtaBandProps) {
  return (
    <section className="py-16 md:py-24">
      <Container>
        <div className="overflow-hidden rounded-[2rem] border border-[var(--ccr-border)] bg-[linear-gradient(135deg,var(--ccr-primary),rgba(15,23,42,0.94))] px-6 py-10 text-white shadow-[0_28px_90px_rgba(15,23,42,0.18)] md:px-10 md:py-14">
          <div className="max-w-3xl">
            {eyebrow ? (
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent)]">
                {eyebrow}
              </p>
            ) : null}
            <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-5xl">{title}</h2>
            <p className="mt-4 text-base leading-7 text-white/78 md:text-lg">{description}</p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              href={primaryAction.href}
              variant={primaryAction.variant ?? "primary"}
              className={primaryAction.className ?? "bg-[var(--ccr-accent)] text-[var(--ccr-primary)] hover:bg-[#ffd588]"}
            >
              {primaryAction.label}
            </Button>
            {secondaryAction ? (
              <Button
                href={secondaryAction.href}
                variant={secondaryAction.variant ?? "outline"}
                className={secondaryAction.className ?? "border-white/20 bg-white/6 text-white hover:bg-white/12"}
              >
                {secondaryAction.label}
              </Button>
            ) : null}
          </div>
        </div>
      </Container>
    </section>
  );
}
