import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui/tooltip";

/** One icon action in the toolbar or inside the incident popover. */
export function MessageAction({ icon: Icon, label, onClick, disabled }: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The action row under a message body. Always present and always legible — a
 * toolbar you cannot see is not a toolbar — but at the lowest emphasis until the
 * message is hovered. Failures are not represented here; they get their own
 * card (see `incident-card.tsx`), because a lone marker leaves users guessing.
 */
export function MessageToolbar({ children, trailing, className }: {
  children?: ReactNode;
  /**
   * Static facts that close the row, after the last action. Visible at rest like
   * the actions themselves — a completion time nobody can see reads as missing.
   */
  trailing?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={100}>
      <div className={cn("mt-1 flex h-6 items-center gap-0.5", className)}>
        {/* A 14px glyph centred in a 24px button sits 5px right of the button box;
            cancel that so the toolbar shares the left edge of the body and notice. */}
        <span className="-ml-[5px] flex items-center gap-0.5 text-hint transition-colors group-hover:text-sub group-focus-within:text-sub">
          {children}
        </span>
        {trailing ? <span className="ml-1.5 flex items-center">{trailing}</span> : null}
      </div>
    </TooltipProvider>
  );
}
