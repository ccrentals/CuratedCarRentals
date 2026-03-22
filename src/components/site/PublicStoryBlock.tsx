import Image from "next/image";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PublicStoryBlockProps = {
  eyebrow?: string;
  title: string;
  paragraphs: string[];
  imageSrc: string;
  imageAlt: string;
  reverse?: boolean;
  children?: ReactNode;
};

export function PublicStoryBlock({
  eyebrow,
  title,
  paragraphs,
  imageSrc,
  imageAlt,
  reverse = false,
  children,
}: PublicStoryBlockProps) {
  return (
    <div className={cn("grid gap-10 lg:grid-cols-[1.04fr_0.96fr] lg:items-center", reverse && "lg:grid-cols-[0.96fr_1.04fr]")}>
      <div className={cn(reverse && "lg:order-2")}>
        <div className="relative h-[320px] overflow-hidden rounded-[2rem] border border-[var(--ccr-border)] bg-[var(--ccr-surface)] shadow-[0_24px_80px_rgba(15,23,42,0.12)] md:h-[420px]">
          <Image
            src={imageSrc}
            alt={imageAlt}
            fill
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
      </div>

      <div className={cn("max-w-2xl", reverse && "lg:order-1")}>
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ccr-accent-strong)]">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--ccr-text)] md:text-5xl">{title}</h2>
        <div className="mt-5 space-y-4 text-base leading-7 text-[var(--ccr-muted)]">
          {paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        {children ? <div className="mt-8">{children}</div> : null}
      </div>
    </div>
  );
}
