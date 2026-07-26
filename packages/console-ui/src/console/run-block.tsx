import { FileText, Square } from "lucide-react";

import { cn } from "@/lib/utils";
import { sanitizeMachineText } from "@/console/machine-text";
import { MarkdownMessage } from "@/console/markdown-message";
import { RoleTag } from "@/console/role-tag";
import { RunTime } from "@/console/run-time";
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
  elapsedMs?: number | null;
  activity?: {
    action: string;
    object: string | null;
  } | null;
  processOutputAvailable?: boolean;
  outputUnavailableMessage?: string;
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
  elapsedTime,
  elapsedMs,
  activity,
  processOutputAvailable = true,
  outputUnavailableMessage = "完整输出不可用",
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
        <span className="ml-auto flex items-center gap-2">
          {elapsedMs !== null && elapsedMs !== undefined ? (
            <RunTime mode="running" elapsedMs={elapsedMs} />
          ) : nonBlank(elapsedTime) !== null ? (
            <span className="tnum whitespace-nowrap text-xs text-sub">已进行 {elapsedTime}</span>
          ) : (
            <span className="text-xs text-sub">等待开始</span>
          )}
          {onOpenOutput && processOutputAvailable ? (
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
      ) : activity ? (
        <div
          className="mt-2.5 flex min-w-0 items-center gap-1 overflow-hidden pl-7 text-sm text-sub"
          title={[activity.action, activity.object].filter(Boolean).join(" · ")}
          tabIndex={0}
          data-testid="run-activity"
        >
          <span className="shrink-0">{activity.action}</span>
          {activity.object ? (
            <>
              <span aria-hidden="true" className="text-hint">·</span>
              <span className="truncate">{activity.object}</span>
            </>
          ) : null}
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
      {!processOutputAvailable ? (
        <p className="mt-1.5 pl-7 text-xs text-hint">{outputUnavailableMessage}</p>
      ) : null}
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
