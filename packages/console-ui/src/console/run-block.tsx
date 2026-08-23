import { Ellipsis, FileText, Square } from "lucide-react";
import { useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { OperatorConsoleAppearance } from "@/console/operator-console-appearance";
import { operatorFloatingSurfaceClassName } from "@/console/operator-console-appearance";
import { AgentRunInfoPopover, type AgentRunInfoView } from "@/console/agent-run-info-popover";
import { Button } from "@/ui/button";
import {
  ClaudeTerminalSurface,
  type OperatorClaudeTerminalTraceState,
} from "@/console/claude-terminal-surface";
import { MarkdownMessage } from "@/console/markdown-message";
import type { MarkdownFileReference } from "@/console/markdown-internal-reference";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { MessageAction, MessageToolbar } from "@/console/message-toolbar";
import { ProcessTrail, type ProcessStep } from "@/console/process-trail";
import { RoleTag } from "@/console/role-tag";
import { RunTime } from "@/console/run-time";
import {
  resolveOperatorMemberEngine,
  resolveOperatorMemberPortrait,
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
  sessionId?: string;
  runId?: string;
  engine?: OperatorMemberIdentity["engine"];
  onLoadRunAgentInfo?: (input: { sessionId: string; runId: string; signal: AbortSignal }) => Promise<AgentRunInfoView>;
  onOpenAgentTeamMember?: (teamKey: string, memberSlug: string) => void;
  elapsedTime?: string | null;
  elapsedMs?: number | null;
  activity?: {
    action: string;
    object: string | null;
    /** Safe object for the activity line; falls back to `object` when absent. */
    lineObject?: string | null;
  } | null;
  processOutputAvailable?: boolean;
  outputUnavailableMessage?: string;
  summary?: string | null;
  rawOutput?: string | null;
  steps?: RunBlockStep[] | null;
  /** Thinking and tool calls so far; shown open while the run is live. */
  processSteps?: readonly ProcessStep[] | null;
  liveMarkdown?: string | null;
  /** Claude raw PTY bytes are rendered by xterm, never by the Markdown renderer. */
  claudeTerminal?: OperatorClaudeTerminalTraceState | null;
  onOpenExternalLink?: (url: string) => void;
  onOpenFileReference?: (reference: MarkdownFileReference) => void;
  onOpenTeamMember?: (slug: string) => void;
  onOpenOutput?: (rawOutput: string | null) => void;
  onInterrupt?: () => void;
  onAnalyzeConversation?: () => void;
  interruptLabel?: string;
  variant?: "main" | "embedded";
  className?: string;
  appearance?: OperatorConsoleAppearance;
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
  processSteps,
  liveMarkdown,
  claudeTerminal = null,
  onOpenExternalLink,
  onOpenFileReference,
  onOpenTeamMember,
  sessionId,
  runId,
  engine,
  onLoadRunAgentInfo,
  onOpenAgentTeamMember,
  onOpenOutput,
  onInterrupt,
  onAnalyzeConversation,
  interruptLabel,
  variant = "embedded",
  className,
  appearance = "default",
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
  const resolvedEngine = engine ?? resolveOperatorMemberEngine(role, memberIdentities);
  const canAudit = sessionId !== undefined && runId !== undefined && onLoadRunAgentInfo !== undefined;

  return (
    <div
      className={cn("max-w-[680px]", className)}
      data-layout-variant={variant}
      data-testid="run-block"
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
        {canAudit ? (
          <AgentRunInfoPopover
            sessionId={sessionId!}
            runId={runId!}
            role={role}
            displayName={roleLabel}
            portraitId={resolveOperatorMemberPortrait(role, memberIdentities)}
            engine={resolvedEngine}
            loadInfo={onLoadRunAgentInfo!}
            onOpenAgentTeamMember={onOpenAgentTeamMember}
            appearance={appearance}
          />
        ) : (
          <RoleTag
            label={roleLabel}
            toneKey={role}
            portraitId={resolveOperatorMemberPortrait(role, memberIdentities)}
            engine={resolvedEngine}
            className={variant === "main" ? "h-6 w-6 text-xs" : undefined}
          />
        )}
        <span className="text-sm text-ink">{roleLabel}</span>
        <span className="flex items-center gap-2">
          {elapsedMs !== null && elapsedMs !== undefined ? (
            <RunTime mode="running" elapsedMs={elapsedMs} />
          ) : nonBlank(elapsedTime) !== null ? (
            <span className="tnum whitespace-nowrap text-xs text-sub">
              {t("console.runTime.elapsed", { duration: elapsedTime ?? "" })}
            </span>
          ) : (
            <span className="text-xs text-sub">{t("console.runBlock.waiting")}</span>
          )}
        </span>
      </div>

      {processSteps?.length ? (
        <ProcessTrail
          steps={processSteps}
          className={cn("mt-2.5", variant === "main" ? "pl-8" : "pl-7")}
        />
      ) : null}

      {claudeTerminal !== null ? (
        <div className={variant === "main" ? "pl-8" : "pl-7"}>
          <ClaudeTerminalSurface trace={claudeTerminal} />
        </div>
      ) : usableSteps ? (
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
          title={[activity.action, activityLineObject(activity)].filter(Boolean).join(" · ")}
          tabIndex={0}
          data-testid="run-activity"
        >
          <span className="shrink-0">{activity.action}</span>
          {activityLineObject(activity) ? (
            <>
              <span aria-hidden="true" className="text-hint">·</span>
              <span className="truncate">{activityLineObject(activity)}</span>
            </>
          ) : null}
        </div>
      ) : (
        <div
          className={cn(
            "mt-2.5 max-w-full overflow-x-auto text-sm text-sub",
            variant === "main" ? "pl-8" : "pl-7",
            appearance === "focused" && "[&_.markdown-message>:first-child>:is(h1,h2,h3):first-child]:mt-0",
          )}
          data-testid="run-live-output"
        >
          <MarkdownMessage
            content={liveContent === null
              ? fallbackSummary
              : liveContent}
            density="live"
            mode={liveContent === null ? "static" : "streaming"}
            caretStyle={appearance === "focused" ? "thin" : "default"}
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
      {onOpenOutput || onInterrupt || onAnalyzeConversation ? (
        <MessageToolbar className={variant === "main" ? "pl-8" : "pl-7"}>
          {onOpenOutput && processOutputAvailable ? (
            <MessageAction
              icon={FileText}
              label={t("console.common.fullOutput")}
              onClick={() => onOpenOutput(nonBlank(rawOutput))}
            />
          ) : null}
          {onInterrupt ? (
            <MessageAction
              icon={Square}
              label={interruptLabel ?? t("console.runBlock.stopMember", { member: roleLabel })}
              onClick={onInterrupt}
            />
          ) : null}
          {onAnalyzeConversation ? (
            <DropdownMenu open={analysisMenuOpen} onOpenChange={setAnalysisMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={t("console.sessionAnalysis.moreActions")}
                >
                  <Ellipsis className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className={operatorFloatingSurfaceClassName(appearance)}
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
        </MessageToolbar>
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

function activityLineObject(activity: { object: string | null; lineObject?: string | null }): string | null {
  return activity.lineObject ?? activity.object;
}
