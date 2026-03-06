import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "outline" | "danger" | "ghost";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

type BaseButtonProps = {
  children: ReactNode;
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

type LinkButtonProps = BaseButtonProps & {
  href: string;
};

type NativeButtonProps = BaseButtonProps & {
  href?: never;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
};

type ButtonProps = LinkButtonProps | NativeButtonProps;

const baseClasses =
  "inline-flex items-center justify-center rounded-xl border font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ccr-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ccr-surface)] disabled:cursor-not-allowed disabled:opacity-60";

const sizeClasses: Record<ButtonSize, string> = {
  xs: "min-h-8 px-2.5 py-1 text-[11px]",
  sm: "min-h-10 px-3 py-2 text-xs",
  md: "min-h-11 px-4 py-2 text-sm",
  lg: "min-h-12 px-5 py-3 text-sm",
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-[var(--ccr-accent-strong)] text-white hover:bg-[var(--ccr-accent)]",
  secondary:
    "border-[var(--ccr-border)] bg-[var(--ccr-surface)] text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)]",
  outline:
    "border-[var(--ccr-border)] bg-transparent text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)]",
  danger:
    "border-[var(--ccr-clerk-danger-border)] bg-[var(--ccr-clerk-danger-bg)] text-[var(--ccr-clerk-danger-text)] hover:opacity-90",
  ghost: "border-transparent bg-transparent text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)]",
};

export function buttonStyles({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return cn(baseClasses, sizeClasses[size], variantClasses[variant], className);
}

export function Button({
  children,
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonProps) {
  const classes = buttonStyles({ variant, size, className });

  if ("href" in props && typeof props.href === "string") {
    return (
      <Link href={props.href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button type={props.type ?? "button"} className={classes} disabled={props.disabled}>
      {children}
    </button>
  );
}
