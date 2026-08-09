import { AlertTriangle, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui/tooltip";
import { RunTime } from "@/console/run-time";

/**
 * Everything that went wrong with one message, folded into a single affordance.
 * The timeline shows a warning triangle; the details only open on demand.
 */
export interface MessageIncident {
  label: string;
  /** A real engine diagnostic, when the engine produced one. */
  detail?: string | null;
  /** The visible body stops mid-thought, so it must not be read as final. */
  contentIncomplete?: boolean;
  elapsedMs?: number | null;
  completedAt?: string | null;
  severity?: "warning" | "danger";
}

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
 * The action row under a message body. It is always present and always legible —
 * a toolbar you cannot see is not a toolbar — but sits at the lowest emphasis
 * until the message is hovered. The incident triangle keeps its own colour,
 * because a failed run must not look like a successful one at a glance.
 */
export function MessageToolbar({ incident, incidentDetail, children, className }: {
  incident?: MessageIncident | null;
  /** Recovery actions offered inside the incident popover. */
  incidentDetail?: ReactNode;
  children?: ReactNode;
  className?: string;
}): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const danger = incident?.severity === "danger";

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={100}>
      <div className={cn("mt-1 flex h-6 items-center gap-0.5", className)}>
        <span className="flex items-center gap-0.5 text-hint transition-colors group-hover:text-sub group-focus-within:text-sub">
          {children}
        </span>
        {incident ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label={t("console.messageToolbar.incidentLabel", { state: incident.label })}
              >
                <AlertTriangle
                  className={cn("h-3.5 w-3.5", danger ? "text-danger" : "text-[var(--status-run-fg)]")}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-3">
              <div className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink">
                <span className="font-semibold">{incident.label}</span>
                {incident.elapsedMs !== null && incident.elapsedMs !== undefined ? (
                  <RunTime mode="completed" elapsedMs={incident.elapsedMs} completedAt={incident.completedAt} />
                ) : null}
              </div>
              {incident.contentIncomplete ? (
                <p className="mt-1 text-xs text-sub">{t("console.messageToolbar.incompleteHint")}</p>
              ) : null}
              {incident.detail?.trim() ? (
                <p className="mt-1.5 whitespace-pre-wrap break-words text-xs text-sub">{incident.detail.trim()}</p>
              ) : null}
              {incidentDetail}
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
