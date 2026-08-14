import { cn } from "@/lib/utils";

export type OperatorConsoleAppearance = "default" | "focused";

/**
 * Canonical focused-console token scope. The Page shell and isolated
 * Block/Component stories must both use this composition so an appearance
 * prop never depends on an undocumented ancestor.
 */
export function operatorConsoleAppearanceClassName(
  appearance: OperatorConsoleAppearance,
): string | undefined {
  if (appearance !== "focused") return undefined;

  return cn(
    "bg-[var(--focused-rail)] font-sans text-ink antialiased",
    "[--canvas:var(--focused-canvas)] [--rail:var(--focused-rail)]",
    "[--card:var(--focused-card)] [--input:var(--focused-input)] [--sunken:var(--focused-sunken)]",
    "[--hover:var(--focused-interaction)] [--sel:var(--focused-interaction)]",
    "[--ink:var(--focused-ink)] [--sub:var(--focused-sub)] [--hint:var(--focused-hint)]",
    "[--line:var(--focused-line)] [--line-strong:var(--focused-line-strong)]",
    "[--accent:var(--focused-accent)] [--accent-hover:var(--focused-accent-hover)]",
    "[--floating-surface:var(--focused-floating-surface)]",
    "[&_.font-normal]:font-normal [&_.font-semibold]:font-semibold",
    "[&_[data-testid=main-window-drag-region]]:border-transparent",
    "[&_[data-testid=sidebar-footer]]:border-transparent",
    "[&_[data-testid=conversation-title-header]]:bg-transparent",
    "[&_[data-testid=conversation-bottom-dock]]:bg-transparent",
    "[&_[data-testid=sidebar-brand-region]]:h-[34px]",
    "[&_[data-testid=sidebar-app-actions]]:py-1",
    "[&_[data-testid=sidebar-app-actions]_button]:h-7",
    "[&_[data-testid=sidebar-app-actions]_button]:rounded-md",
    "[&_[data-testid=sidebar-app-actions]_button]:font-normal",
    "[&_[data-testid=sidebar-footer]_button]:font-normal",
    "[&_[data-testid=conversation-sidebar-session]:focus-visible]:outline-none",
    "[&_[data-testid=conversation-sidebar-session]:focus-visible]:ring-1",
    "[&_[data-testid=conversation-sidebar-session]:focus-visible]:ring-inset",
    "[&_[data-testid=conversation-sidebar-session]:focus-visible]:ring-ink/25",
    "[&_[data-testid=conversation-sidebar-session][aria-current=page]]:bg-sel",
    "[&_[data-testid=conversation-sidebar-session][aria-current=page]]:text-ink",
    "[&_[data-testid=conversation-title-header]_h1]:font-sans",
    "[&_[data-testid=conversation-title-header]_h1]:tracking-[-0.018em]",
    "[&_[data-testid^=timeline-message-]_h1]:font-sans [&_[data-testid^=timeline-message-]_h1]:font-semibold [&_[data-testid^=timeline-message-]_h1]:tracking-[-0.018em]",
    "[&_[data-testid^=timeline-message-]_h2]:font-sans [&_[data-testid^=timeline-message-]_h2]:font-semibold [&_[data-testid^=timeline-message-]_h2]:tracking-[-0.018em]",
    "[&_[data-testid^=timeline-message-]_h3]:font-sans [&_[data-testid^=timeline-message-]_h3]:font-semibold [&_[data-testid^=timeline-message-]_h3]:tracking-[-0.018em]",
    "[&_[data-testid^=timeline-message-]_strong]:font-semibold",
    "[&_[data-testid^=timeline-message-]_b]:font-semibold",
    "[&_[data-testid=active-run-block]_h1]:font-sans [&_[data-testid=active-run-block]_h1]:font-semibold [&_[data-testid=active-run-block]_h1]:tracking-[-0.018em]",
    "[&_[data-testid=active-run-block]_h2]:font-sans [&_[data-testid=active-run-block]_h2]:font-semibold [&_[data-testid=active-run-block]_h2]:tracking-[-0.018em]",
    "[&_[data-testid=active-run-block]_h3]:font-sans [&_[data-testid=active-run-block]_h3]:font-semibold [&_[data-testid=active-run-block]_h3]:tracking-[-0.018em]",
    "[&_[data-testid=active-run-block]_strong]:font-semibold",
    "[&_[data-testid=active-run-block]_b]:font-semibold",
  );
}

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
      "border border-line bg-[var(--focused-floating-surface)] text-[var(--focused-ink)] shadow-md dark:shadow-none",
      "[--ink:var(--focused-ink)] [--sub:var(--focused-sub)] [--hint:var(--focused-hint)]",
      "[--line:var(--focused-line)] [--line-strong:var(--focused-line-strong)]",
      "[--hover:var(--focused-interaction)] [--sel:var(--focused-interaction)]",
      "[--accent:var(--focused-accent)] [--accent-hover:var(--focused-accent-hover)]",
    ],
  );
}
