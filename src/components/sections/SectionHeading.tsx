import { cn } from "@/lib/utils";

type SectionHeadingProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  className?: string;
  tone?: "default" | "light";
};

export function SectionHeading({
  title,
  description,
  eyebrow,
  className,
  tone = "default",
}: SectionHeadingProps) {
  const eyebrowClass =
    tone === "light" ? "text-[var(--ccr-accent)]" : "text-[var(--ccr-muted)]";
  const titleClass = tone === "light" ? "text-white" : "text-[var(--ccr-text)]";
  const descriptionClass =
    tone === "light" ? "text-slate-200" : "text-[var(--ccr-muted)]";

  return (
    <div className={cn("max-w-3xl", className)}>
      {eyebrow ? (
        <p className={cn("text-xs font-bold uppercase tracking-wider", eyebrowClass)}>{eyebrow}</p>
      ) : null}
      <h1 className={cn("mt-2 text-3xl font-extrabold tracking-tight md:text-4xl", titleClass)}>{title}</h1>
      {description ? <p className={cn("mt-3 text-base", descriptionClass)}>{description}</p> : null}
    </div>
  );
}
