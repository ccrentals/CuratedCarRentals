import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary";

type BaseButtonProps = {
  children: ReactNode;
  className?: string;
  variant?: ButtonVariant;
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
  "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--ccr-accent-strong)] text-white hover:bg-[var(--ccr-accent)]",
  secondary:
    "border border-[var(--ccr-border)] bg-[var(--ccr-surface)] text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)]",
};

export function Button({
  children,
  className,
  variant = "primary",
  ...props
}: ButtonProps) {
  const classes = cn(baseClasses, variantClasses[variant], className);

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
