export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

import { formatJmd } from "@/lib/money";

export function formatCurrency(value: number) {
  return formatJmd(value);
}
