import { cva, type VariantProps } from "class-variance-authority";
import { Circle, CircleCheck, CircleDashed, CircleX, Clock } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-[26px] items-center gap-[5px] rounded-full border px-[11px] text-sm font-normal leading-none whitespace-nowrap",
  {
    variants: {
      variant: {
        running:
          "border-[var(--status-run-line)] bg-[var(--status-run-bg)] text-[var(--status-run-fg)]",
        pending:
          "border-[var(--status-info-line)] bg-[var(--status-info-bg)] text-[var(--status-info-fg)]",
        waiting:
          "border-[var(--status-violet-line)] bg-[var(--status-violet-bg)] text-[var(--status-violet-fg)]",
        completed:
          "border-[var(--status-neutral-line)] bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]",
        failed:
          "border-[var(--status-danger-line)] bg-[var(--status-danger-bg)] text-danger",
        stuck:
          "border-[var(--status-danger-line)] bg-[var(--status-danger-bg)] text-danger",
        interrupted: "border-[var(--status-neutral-line)] text-sub",
        pass: "border-[var(--status-pass-line)] bg-[var(--status-pass-bg)] text-pass"
      }
    },
    defaultVariants: {
      variant: "interrupted"
    }
  }
);

/* i18n-exempt: developer-only note; running uses a custom 12px half-filled pie icon. */
function HalfPieIcon(): JSX.Element {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </svg>
  );
}

const badgeIcons: Record<NonNullable<BadgeProps["variant"]>, () => JSX.Element> = {
  running: HalfPieIcon,
  pending: () => <Clock className="h-3 w-3" strokeWidth={2} />,
  waiting: () => <Circle className="h-3 w-3" strokeWidth={2} />,
  completed: () => <Circle className="h-3 w-3 fill-current" strokeWidth={2} />,
  failed: () => <CircleX className="h-3 w-3" strokeWidth={2} />,
  stuck: () => <CircleX className="h-3 w-3" strokeWidth={2} />,
  interrupted: () => <CircleDashed className="h-3 w-3" strokeWidth={2} />,
  pass: () => <CircleCheck className="h-3 w-3" strokeWidth={2} />
};

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant = "interrupted", children, ...props }: BadgeProps): JSX.Element {
  const Icon = badgeIcons[variant ?? "interrupted"];
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      <Icon />
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
