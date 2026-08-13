import { cn } from "@/lib/utils";

import type { OperatorConsoleAppearance } from "@/console/operator-console";

/**
 * Radix portals are mounted outside the console root, so focused aliases must
 * travel with the floating surface instead of relying on DOM inheritance.
 */
export function operatorFloatingSurfaceClassName(
  appearance: OperatorConsoleAppearance,
  className?: string,
): string {
  return cn(
    className,
    appearance === "focused" && [
      "border-0 bg-[var(--focused-floating-surface)] text-[var(--focused-ink)] shadow-floating",
      "[--ink:var(--focused-ink)] [--sub:var(--focused-sub)] [--hint:var(--focused-hint)]",
      "[--line:var(--focused-line)] [--line-strong:var(--focused-line-strong)]",
      "[--hover:var(--focused-interaction)] [--sel:var(--focused-interaction)]",
      "[--accent:var(--focused-accent)] [--accent-hover:var(--focused-accent-hover)]",
    ],
  );
}
