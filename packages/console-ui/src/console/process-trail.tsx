import { Brain, ChevronRight, FilePen, Search, Terminal, Wrench, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export type ProcessStepKind = "thinking" | "tool" | "command" | "file" | "search";
export type ProcessStepStatus = "running" | "done" | "failed";

export interface ProcessStep {
  id: string;
  kind: ProcessStepKind;
  /** One line, already human-readable — this is not a raw log line. */
  title: string;
  detail?: string | null;
  status?: ProcessStepStatus;
}

const stepIcons: Record<ProcessStepKind, LucideIcon> = {
  thinking: Brain,
  tool: Wrench,
  command: Terminal,
  file: FilePen,
  search: Search,
};

/**
 * The work a member did on the way to its answer.
 *
 * While the run is live the steps accumulate in the open, so the user can watch
 * and interrupt. Once the answer lands the trail folds into a single line: the
 * conclusion should read as one self-contained message, with the process still
 * one click away rather than deleted.
 */
export function ProcessTrail({ steps, collapsed = false, className }: {
  steps: readonly ProcessStep[];
  /** true once the final answer landed. */
  collapsed?: boolean;
  className?: string;
}): JSX.Element | null {
  const { t } = useI18n();
  const [open, setOpen] = useState(!collapsed);

  if (steps.length === 0) return null;

  const folded = collapsed && !open;

  return (
    <div className={cn("text-sm", className)}>
      {collapsed ? (
        <button
          type="button"
          className="flex items-center gap-1 rounded-md py-0.5 text-sub transition-colors hover:text-ink"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronRight
            className={cn("h-3.5 w-3.5 transition-transform", open ? "rotate-90" : undefined)}
            strokeWidth={1.5}
            aria-hidden="true"
          />
          {t("console.processTrail.summary", { count: String(steps.length) })}
        </button>
      ) : null}
      {folded ? null : (
        <ol className={cn("space-y-1", collapsed ? "mt-1.5 pl-[18px]" : undefined)}>
          {steps.map((step) => {
            const Icon = stepIcons[step.kind];
            const running = step.status === "running";
            return (
              <li key={step.id} className="flex items-start gap-2 leading-5">
                <Icon
                  className={cn(
                    "mt-[3px] h-3.5 w-3.5 shrink-0",
                    step.status === "failed" ? "text-danger" : "text-hint",
                  )}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className={cn(running ? "text-ink" : "text-sub")}>{step.title}</span>
                  {step.detail?.trim() ? (
                    <span className="ml-1.5 break-words text-hint">{step.detail.trim()}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
