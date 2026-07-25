import { FileText, Square } from "lucide-react";

import { cn } from "@/lib/utils";
import { sanitizeMachineText } from "@/console/machine-text";
import { MarkdownMessage } from "@/console/markdown-message";
import { RoleTag } from "@/console/role-tag";
import {
  resolveOperatorMemberName,
  type OperatorMemberIdentity,
} from "@/console/member-name";

export type RunBlockStepStatus = "completed" | "running" | "pending";

export interface RunBlockStep {
  id?: string;
  title: string;
  status: RunBlockStepStatus;
  summary?: string | null;
  rawOutput?: string | null;
}

export interface RunBlockProps {
  role: string;
  memberIdentities?: readonly OperatorMemberIdentity[];
  elapsedTime?: string | null;
  summary?: string | null;
  rawOutput?: string | null;
  steps?: RunBlockStep[] | null;
  liveMarkdown?: string | null;
  onOpenExternalLink?: (url: string) => void;
  onOpenOutput?: (rawOutput: string | null) => void;
  onInterrupt?: () => void;
  interruptLabel?: string;
  className?: string;
}

export function RunBlock({
  role,
  memberIdentities = [],
  elapsedTime: _elapsedTime,
  summary,
  rawOutput,
  steps,
  liveMarkdown,
  onOpenExternalLink,
  onOpenOutput,
  onInterrupt,
  interruptLabel,
  className,
}: RunBlockProps): JSX.Element {
  const roleLabel = resolveOperatorMemberName(role, memberIdentities, "协作者");
  const usableSteps = steps?.length ? steps : null;
  const liveContent = nonBlank(liveMarkdown);
  const fallbackSummary = sanitizeMachineText(nonBlank(summary) ?? "正在推进这一步…", "正在推进这一步…");

  return (
    <div className={cn("max-w-[680px]", className)}>
      <div className="flex items-center gap-2">
        <RoleTag label={roleLabel} toneKey={role} />
        <span className="text-[12.5px] font-semibold text-ink">{roleLabel}</span>
        <span className="ml-auto flex items-center gap-0.5">
          {onOpenOutput ? (
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-md text-sub transition-colors hover:bg-hover hover:text-ink"
              aria-label="完整输出"
              title="完整输出"
              onClick={() => onOpenOutput(nonBlank(rawOutput))}
            >
              <FileText className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : null}
          {onInterrupt ? (
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-md text-sub transition-colors hover:bg-hover hover:text-ink"
              onClick={onInterrupt}
              aria-label={interruptLabel ?? `停下${roleLabel}`}
              title={interruptLabel ?? `停下${roleLabel}`}
            >
              <Square className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : null}
        </span>
      </div>

      {usableSteps ? (
        <div className="mt-2.5 space-y-2.5 pl-7">
          {usableSteps.map((step, index) => (
            <RunStepItem key={step.id ?? `${step.title}-${index}`} step={step} index={index} />
          ))}
        </div>
      ) : (
        <div className="mt-2.5 max-w-full overflow-x-auto pl-7 text-sm text-sub" data-testid="run-live-output">
          <MarkdownMessage
            content={liveContent === null
              ? fallbackSummary
              : sanitizeMachineText(liveContent, "正在推进这一步…")}
            density="live"
            mode={liveContent === null ? "static" : "streaming"}
            onOpenExternalLink={onOpenExternalLink}
          />
        </div>
      )}
    </div>
  );
}

function RunStepItem({ step }: { step: RunBlockStep; index: number }): JSX.Element {
  const summary = nonBlank(step.summary);

  return (
    <div className="border-l border-line pl-3 text-sm text-ink">
      <span>{sanitizeMachineText(step.title)}</span>
      {summary ? <span className="mt-0.5 block text-xs leading-5 text-sub">{sanitizeMachineText(summary)}</span> : null}
    </div>
  );
}

function nonBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
