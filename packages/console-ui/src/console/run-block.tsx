import { Ellipsis, FileText, Square } from "lucide-react";
import { useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { MarkdownMessage } from "@/console/markdown-message";
import type { MarkdownFileReference } from "@/console/markdown-internal-reference";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
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
  onOpenFileReference?: (reference: MarkdownFileReference) => void;
  onOpenTeamMember?: (slug: string) => void;
  onOpenOutput?: (rawOutput: string | null) => void;
  onInterrupt?: () => void;
  onAnalyzeConversation?: () => void;
  interruptLabel?: string;
  variant?: "main" | "embedded";
  className?: string;
}

export function RunBlock({
  role,
  memberIdentities = [],
  elapsedTime,
  elapsedMs,
  activity,
  processOutputAvailable = true,
  outputUnavailableMessage,
  summary,
  rawOutput,
  steps,
  liveMarkdown,
  onOpenExternalLink,
  onOpenFileReference,
  onOpenTeamMember,
  onOpenOutput,
  onInterrupt,
  onAnalyzeConversation,
  interruptLabel,
  variant = "embedded",
  className,
}: RunBlockProps): JSX.Element {
  const { t } = useI18n();
  const [analysisMenuOpen, setAnalysisMenuOpen] = useState(false);
  const analysisMenuReturnFocusRef = useRef<HTMLElement | null>(null);
  const roleLabel = resolveOperatorMemberName(
    role,
    memberIdentities,
    t,
    t("console.common.collaborator"),
  );
  const usableSteps = steps?.length ? steps : null;
  const liveContent = nonBlank(liveMarkdown);
  const progressFallback = t("console.runBlock.progress");
  const fallbackSummary = nonBlank(summary) ?? progressFallback;

  return (
    <div
      className={cn("max-w-[680px]", className)}
      data-layout-variant={variant}
      tabIndex={onAnalyzeConversation ? 0 : undefined}
      onContextMenu={(event) => {
        if (onAnalyzeConversation) {
          event.preventDefault();
          analysisMenuReturnFocusRef.current = event.currentTarget;
          setAnalysisMenuOpen(true);
        }
      }}
      onKeyDown={(event) => {
        if (
          onAnalyzeConversation
          && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
        ) {
          event.preventDefault();
          analysisMenuReturnFocusRef.current = event.currentTarget;
          setAnalysisMenuOpen(true);
        }
      }}
    >
      <div className="flex items-center gap-2">
        <RoleTag
          label={roleLabel}
          toneKey={role}
          className={variant === "main" ? "h-6 w-6 text-xs" : undefined}
        />
        <span className="text-[12.5px] font-semibold text-ink">{roleLabel}</span>
        <span className="ml-auto flex items-center gap-2">
          {elapsedMs !== null && elapsedMs !== undefined ? (
            <RunTime mode="running" elapsedMs={elapsedMs} />
          ) : nonBlank(elapsedTime) !== null ? (
            <span className="tnum whitespace-nowrap text-xs text-sub">
              {t("console.runTime.elapsed", { duration: elapsedTime ?? "" })}
            </span>
          ) : (
            <span className="text-xs text-sub">{t("console.runBlock.waiting")}</span>
          )}
          {onOpenOutput && processOutputAvailable ? (
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-md text-sub transition-colors hover:bg-hover hover:text-ink"
              aria-label={t("console.common.fullOutput")}
              title={t("console.common.fullOutput")}
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
              aria-label={interruptLabel ?? t("console.runBlock.stopMember", { member: roleLabel })}
              title={interruptLabel ?? t("console.runBlock.stopMember", { member: roleLabel })}
            >
              <Square className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : null}
          {onAnalyzeConversation ? (
            <DropdownMenu open={analysisMenuOpen} onOpenChange={setAnalysisMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-sub transition-colors hover:bg-hover hover:text-ink"
                  aria-label={t("console.sessionAnalysis.moreActions")}
                  title={t("console.sessionAnalysis.moreActions")}
                >
                  <Ellipsis className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onCloseAutoFocus={(event) => {
                  if (analysisMenuReturnFocusRef.current !== null) {
                    event.preventDefault();
                    analysisMenuReturnFocusRef.current.focus();
                    analysisMenuReturnFocusRef.current = null;
                  }
                }}
              >
                <DropdownMenuItem onSelect={onAnalyzeConversation}>
                  {t("console.sessionAnalysis.analyzeMessage")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </span>
      </div>

      {usableSteps ? (
        <div className={cn("mt-2.5 space-y-2.5", variant === "main" ? "pl-8" : "pl-7")}>
          {usableSteps.map((step, index) => (
            <RunStepItem key={step.id ?? `${step.title}-${index}`} step={step} index={index} />
          ))}
        </div>
      ) : activity ? (
        <div
          className={cn(
            "mt-2.5 flex min-w-0 items-center gap-1 overflow-hidden text-sm text-sub",
            variant === "main" ? "pl-8" : "pl-7",
          )}
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
        <div
          className={cn(
            "mt-2.5 max-w-full overflow-x-auto text-sm text-sub",
            variant === "main" ? "pl-8" : "pl-7",
          )}
          data-testid="run-live-output"
        >
          <MarkdownMessage
            content={liveContent === null
              ? fallbackSummary
              : liveContent}
            density="live"
            mode={liveContent === null ? "static" : "streaming"}
            onOpenExternalLink={onOpenExternalLink}
            onOpenFileReference={onOpenFileReference}
            memberIdentities={memberIdentities}
            onOpenTeamMember={onOpenTeamMember}
          />
        </div>
      )}
      {!processOutputAvailable ? (
        <p className={cn("mt-1.5 text-xs text-hint", variant === "main" ? "pl-8" : "pl-7")}>
          {outputUnavailableMessage ?? t("console.common.outputUnavailable")}
        </p>
      ) : null}
    </div>
  );
}

function RunStepItem({ step }: { step: RunBlockStep; index: number }): JSX.Element {
  const summary = nonBlank(step.summary);

  return (
    <div className="border-l border-line pl-3 text-sm text-ink">
      <span>{step.title}</span>
      {summary ? (
        <span className="mt-0.5 block text-xs leading-5 text-sub">
          {summary}
        </span>
      ) : null}
    </div>
  );
}

function nonBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
