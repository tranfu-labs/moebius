import type { ReactNode } from "react";

import { MarkdownMessage } from "@/console/markdown-message";
import type { MarkdownFileReference } from "@/console/markdown-internal-reference";
import type {
  OperatorChildSessionSummary,
  OperatorMessage,
  OperatorRunSnapshot,
  OperatorSubSessionView,
} from "@/console/operator-console";
import { RoleComposer, type RoleCompletion } from "@/console/role-composer";
import { FileText } from "lucide-react";
import { RoleTag } from "@/console/role-tag";
import { RunBlock } from "@/console/run-block";
import {
  RunOutcome,
  outcomeSeverity,
  resolveOutcomeDescriptionKey,
  resolveOutcomeLabelKey,
  type RunOutcomeStatus,
} from "@/console/run-outcome";
import { MessageAction, MessageToolbar } from "@/console/message-toolbar";
import { IncidentCard } from "@/console/incident-card";
import { stripLegacyOutcomeBoilerplate } from "@/console/legacy-run-outcome-copy";
import { RunTime } from "@/console/run-time";
import type {
  ExecutionRegistryState,
  RegistryExecutionProfile,
  RegistryProviderProfile,
} from "@/console/execution-profile-registry";
import { StructuredAttachmentList, type ComposerAttachment } from "@/console/structured-attachments";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  resolveOperatorMemberEngine,
  resolveOperatorMemberName,
  resolveOperatorMemberPortrait,
} from "@/console/member-name";
import { useI18n, type Translate } from "@/i18n";

export type OperatorSubSessionViewState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; view: OperatorSubSessionView };

export interface SubtaskTabProps {
  sessionId: string;
  summary: OperatorChildSessionSummary | null;
  state: OperatorSubSessionViewState;
  composerValue: string;
  composerAttachments?: readonly ComposerAttachment[];
  roles?: readonly RoleCompletion[];
  sending?: boolean;
  onComposerChange(value: string): void;
  onComposerFilesAdded?: (files: File[]) => void;
  onComposerAttachmentRemove?: (clientId: string) => void;
  onComposerAttachmentRetry?: (clientId: string) => void;
  onSend(): void;
  onRetry(runId: string, executionOverride?: RegistryExecutionProfile): void | Promise<void>;
  onUpdateMemberExecution?: (
    sessionId: string,
    memberName: string,
    action: "migrate" | "end",
    profile?: RegistryExecutionProfile,
  ) => void | Promise<void>;
  executionRegistryState?: ExecutionRegistryState;
  providerProfiles?: readonly RegistryProviderProfile[];
  onReloadExecutionRegistry?: () => void;
  onInterrupt(sessionId: string, runId: string): void;
  onOpenOutput?(input: {
    sessionId: string;
    runId: string;
    stepId: string | null;
    role: string | null;
    fallbackOutput: string | null;
  }): void;
  onOpenExternalLink?: (url: string) => void;
  onOpenFileReference?: (reference: MarkdownFileReference) => void;
  onOpenTeamMember?: (slug: string) => void;
  className?: string;
}

export function SubtaskTab({
  sessionId,
  summary,
  state,
  composerValue,
  composerAttachments = [],
  roles = [],
  sending = false,
  onComposerChange,
  onComposerFilesAdded,
  onComposerAttachmentRemove,
  onComposerAttachmentRetry,
  onSend,
  onRetry,
  onUpdateMemberExecution,
  executionRegistryState,
  providerProfiles = [],
  onReloadExecutionRegistry,
  onInterrupt,
  onOpenOutput,
  onOpenExternalLink,
  onOpenFileReference,
  onOpenTeamMember,
  className,
}: SubtaskTabProps): JSX.Element {
  const { t } = useI18n();
  const view = state.status === "ready" ? state.view : null;
  const activeRun = view?.activeRun ?? null;
  const memberIdentities = view?.memberIdentities ?? [];
  const continuationBlocked = view?.session.continuation?.canContinue === false;
  const disabled = sending || continuationBlocked || state.status !== "ready";
  const title = summary?.title ?? view?.session.title ?? t("console.subtask.title");
  const memberName = summary?.memberName ?? resolveOperatorMemberName(
    activeRun?.role ?? view?.messages.find((message) => message.speaker === "agent")?.role ?? null,
    memberIdentities,
    t,
    t("console.common.unknownMember"),
  );
  const statusLabel = summary?.statusLabel ?? fallbackStatusLabel(view?.session.status, t);

  return (
    <section
      className={cn("flex min-h-full flex-col", className)}
      aria-label={t("console.subtask.label", { title })}
      data-session-id={sessionId}
      data-testid="subtask-tab"
    >
      <header className="shrink-0 border-b border-line px-5 py-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <h2 className="min-w-0 truncate font-semibold text-ink" title={title}>{title}</h2>
          <span aria-hidden="true" className="text-hint">·</span>
          <span className="shrink-0 text-[12.5px] text-sub">{memberName}</span>
          <Badge variant={subtaskBadgeVariant(summary?.status ?? view?.session.status)}>{statusLabel}</Badge>
        </div>
        <p className="mt-1 text-xs leading-5 text-hint">
          {t("console.subtask.closeNotice")}
        </p>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-auto px-5 pb-4">
        {state.status === "error" ? (
          <SubtaskStateMessage tone="danger">{state.message}</SubtaskStateMessage>
        ) : view === null ? (
          <SubtaskStateMessage>{t("console.subtask.loading")}</SubtaskStateMessage>
        ) : (
          <div>
            {view.messages.length === 0 && activeRun === null ? (
              <SubtaskStateMessage>{t("console.subtask.empty")}</SubtaskStateMessage>
            ) : null}
            {view.messages.map((message) => (
              <SubtaskTimelineEntry
                key={message.id}
                message={message}
                processRole={resolveMessageProcessRole(message, view.messages)}
                memberIdentities={memberIdentities}
                onRetry={onRetry}
                onUpdateMemberExecution={onUpdateMemberExecution}
                executionRegistryState={executionRegistryState}
                providerProfiles={providerProfiles}
                onReloadExecutionRegistry={onReloadExecutionRegistry}
                onOpenOutput={onOpenOutput}
                onOpenExternalLink={onOpenExternalLink}
                onOpenFileReference={onOpenFileReference}
                onOpenTeamMember={onOpenTeamMember}
              />
            ))}
            {activeRun ? (
              <div className="py-4" data-testid="subtask-active-run">
                <RunBlock
                  role={activeRun.role ?? "dev"}
                  memberIdentities={memberIdentities}
                  elapsedMs={activeRun.elapsedMs}
                  activity={activeRun.activity}
                  processOutputAvailable
                  outputUnavailableMessage={t("console.common.providerOutputUnavailable")}
                  summary={activeRun.lastOutputSummary}
                  liveMarkdown={activeRun.liveMarkdown}
                  rawOutput={activeRun.stderrTail ?? activeRun.stdoutTail}
                  onOpenExternalLink={onOpenExternalLink}
                  onOpenFileReference={onOpenFileReference}
                  onOpenTeamMember={onOpenTeamMember}
                  onOpenOutput={onOpenOutput === undefined
                    ? undefined
                    : (fallbackOutput) => onOpenOutput({
                        sessionId: activeRun.sessionId,
                        runId: activeRun.runId,
                        stepId: activeRun.stepId ?? null,
                        role: activeRun.role,
                        fallbackOutput,
                      })}
                  onInterrupt={activeRun.interruptible
                    ? () => onInterrupt(sessionId, activeRun.runId)
                    : undefined}
                  interruptLabel={t("console.runBlock.stopMember", {
                    member: resolveOperatorMemberName(
                      activeRun.role,
                      memberIdentities,
                      t,
                      t("console.subtask.currentStep"),
                    ),
                  })}
                  className="max-w-none"
                />
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-canvas px-5 py-4">
        <RoleComposer
          value={composerValue}
          attachments={composerAttachments}
          onValueChange={onComposerChange}
          onFilesAdded={onComposerFilesAdded}
          onAttachmentRemove={onComposerAttachmentRemove}
          onAttachmentRetry={onComposerAttachmentRetry}
          onSubmit={onSend}
          runActive={activeRun !== null}
          onInterrupt={undefined}
          roles={roles}
          disabled={disabled}
          placeholder={continuationBlocked
            ? view?.session.continuation?.reason ?? t("console.subtask.cannotContinue")
            : activeRun
              ? t("console.subtask.activePlaceholder")
              : t("console.subtask.placeholder")}
          statusText={continuationBlocked
            ? view?.session.continuation?.reason ?? t("console.subtask.cannotContinue")
            : undefined}
          className="mx-auto max-w-[720px]"
        />
      </div>
    </section>
  );
}

function SubtaskTimelineEntry({
  message,
  processRole,
  memberIdentities,
  onRetry,
  onUpdateMemberExecution,
  executionRegistryState,
  providerProfiles,
  onReloadExecutionRegistry,
  onOpenOutput,
  onOpenExternalLink,
  onOpenFileReference,
  onOpenTeamMember,
}: {
  message: OperatorMessage;
  processRole: string | null;
  memberIdentities: NonNullable<OperatorSubSessionView["memberIdentities"]>;
  onRetry(runId: string, executionOverride?: RegistryExecutionProfile): void | Promise<void>;
  onUpdateMemberExecution?: SubtaskTabProps["onUpdateMemberExecution"];
  executionRegistryState?: ExecutionRegistryState;
  providerProfiles: readonly RegistryProviderProfile[];
  onReloadExecutionRegistry?: () => void;
  onOpenOutput?: SubtaskTabProps["onOpenOutput"];
  onOpenExternalLink?: (url: string) => void;
  onOpenFileReference?: (reference: MarkdownFileReference) => void;
  onOpenTeamMember?: (slug: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const outcome = terminalOutcome(message);
  if (outcome !== null) {
    // Same rule as the main conversation: the terminal status never swallows the
    // body; produced content renders normally and the status is a bubble below it.
    const partialMarkdown = message.terminal?.partialMarkdown?.trim() ?? "";
    const identityRole = message.role ?? processRole;
    const recoveryActions = (
      <RunOutcome
      status={outcome}
      rawReason={message.error ?? message.body}
      initialProfile={message.terminal?.actualProfile}
      executionRegistryState={executionRegistryState}
      providerProfiles={providerProfiles}
      onReloadExecutionRegistry={onReloadExecutionRegistry}
      onRetry={outcome !== "retry-exhausted" && message.runId !== null
        ? () => onRetry(message.runId!)
        : undefined}
      onOverrideAndRetry={
        message.runId !== null
        && message.terminal !== null
        && message.terminal !== undefined
        && (
          message.terminal.kind === "interrupted"
          || message.terminal.kind === "timeout"
          || message.terminal.kind === "quota-exhausted"
          || message.terminal.kind === "rate-limited"
          || message.terminal.kind === "auth"
          || message.terminal.kind === "crashed"
        )
          ? (profile) => onRetry(message.runId!, profile)
          : undefined
      }
      onMigrateAndContinue={message.terminal?.actualProfile?.cli === "pi"
        && processRole !== null
        && onUpdateMemberExecution !== undefined
        ? (profile) => onUpdateMemberExecution?.(message.sessionId, processRole, "migrate", profile)
        : undefined}
      onEndContinuation={message.terminal?.actualProfile?.cli === "pi"
        && processRole !== null
        && onUpdateMemberExecution !== undefined
        ? () => onUpdateMemberExecution?.(message.sessionId, processRole, "end")
        : undefined}
      />
    );
    return (
      <article className="group py-4 text-sm">
        {identityRole === null ? null : (
          <div className="mb-1.5 flex items-center gap-2 text-[12.5px] text-sub">
            <RoleTag
              label={resolveOperatorMemberName(identityRole, memberIdentities, t)}
              toneKey={identityRole}
              portraitId={resolveOperatorMemberPortrait(identityRole, memberIdentities)}
              engine={resolveOperatorMemberEngine(identityRole, memberIdentities)}
            />
            <span className="font-semibold text-ink">
              {resolveOperatorMemberName(identityRole, memberIdentities, t)}
            </span>
            {message.runTiming?.elapsedMs !== null && message.runTiming?.elapsedMs !== undefined ? (
              <RunTime
                mode="completed"
                elapsedMs={message.runTiming.elapsedMs}
                completedAt={message.runTiming.completedAt}
              />
            ) : null}
          </div>
        )}
        <div className={identityRole === null ? undefined : "pl-7"}>
        {partialMarkdown === "" ? null : (
          <MarkdownMessage
            content={partialMarkdown}
            mode="static"
            onOpenExternalLink={onOpenExternalLink}
            onOpenFileReference={onOpenFileReference}
            memberIdentities={memberIdentities}
            onOpenTeamMember={onOpenTeamMember}
          />
        )}
        <div className={cn("flex flex-wrap items-center gap-2", partialMarkdown === "" ? undefined : "mt-2")}>
        {partialMarkdown !== "" && message.terminal?.contentIncomplete ? (
          <span className="inline-flex rounded bg-muted px-1.5 py-0.5 text-[11px] text-sub">
            {t("console.runOutcome.incomplete")}
          </span>
        ) : null}
      <MessageToolbar>
          {message.runId !== null && onOpenOutput !== undefined ? (
            <MessageAction
              icon={FileText}
              label={t("console.common.fullOutput")}
              onClick={() => onOpenOutput({
                sessionId: message.sessionId,
                runId: message.runId!,
                stepId: message.runTiming?.stepId ?? null,
                role: processRole,
                fallbackOutput: message.error ?? message.body,
              })}
            />
          ) : null}
          {outcome === "user-stopped" ? recoveryActions : null}
        </MessageToolbar>
        {outcome === "user-stopped" ? null : (
          <IncidentCard
            className="mt-1.5"
            incident={{
              label: t(resolveOutcomeLabelKey(outcome, null)),
              detail: stripLegacyOutcomeBoilerplate(
                message.terminal === null || message.terminal === undefined ? null : message.body,
              ) || (resolveOutcomeDescriptionKey(outcome, null) === null
                ? null
                : t(resolveOutcomeDescriptionKey(outcome, null)!)),
              contentIncomplete: partialMarkdown !== "" && message.terminal?.contentIncomplete === true,
              elapsedMs: message.runTiming?.elapsedMs,
              completedAt: message.runTiming?.completedAt,
              severity: outcomeSeverity(outcome),
            }}
            actions={recoveryActions}
          />
        )}
        </div>
        </div>
      </article>
    );
  }

  if (message.speaker === "user") {
    return (
      <article className="py-4 text-sm">
        <div className="mb-1.5 flex items-center justify-end gap-2 text-[12.5px] text-sub">
          <span className="font-semibold text-ink">{t("console.common.you")}</span>
          <RoleTag label={t("console.common.you")} toneKey="user" />
        </div>
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-[14px] border border-line bg-card px-3.5 py-2.5">
            {message.body.trim() === "" ? null : (
              <MarkdownMessage
                content={message.body}
                mode="static"
                onOpenExternalLink={onOpenExternalLink}
                onOpenFileReference={onOpenFileReference}
                memberIdentities={memberIdentities}
                onOpenTeamMember={onOpenTeamMember}
              />
            )}
            <StructuredAttachmentList
              attachments={message.attachments ?? []}
              mode="message"
              className={message.body.trim() === "" ? "" : "mt-2"}
            />
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="py-4 text-sm">
      <div className="mb-1.5 flex items-center gap-2 text-[12.5px] text-sub">
        {message.speaker === "agent" ? (
          <RoleTag
            label={resolveOperatorMemberName(message.role, memberIdentities, t)}
            toneKey={message.role ?? "agent"}
            portraitId={resolveOperatorMemberPortrait(message.role, memberIdentities)}
            engine={resolveOperatorMemberEngine(message.role, memberIdentities)}
          />
        ) : null}
        <span className="font-semibold text-ink">
          {message.speaker === "agent"
            ? resolveOperatorMemberName(message.role, memberIdentities, t)
            : t("console.common.systemNotice")}
        </span>
        {message.speaker === "agent"
        && message.runTiming?.elapsedMs !== null
        && message.runTiming?.elapsedMs !== undefined ? (
          <RunTime
            mode="completed"
            elapsedMs={message.runTiming.elapsedMs}
            completedAt={message.runTiming.completedAt}
          />
        ) : null}
      </div>
      <div className="pl-7">
      {message.speaker === "system" ? (
        <p className="whitespace-pre-wrap break-words leading-6 text-ink">{message.body}</p>
      ) : (
        <>
          {message.body.trim() === "" ? null : (
            <MarkdownMessage
              content={message.body}
              mode="static"
              onOpenExternalLink={onOpenExternalLink}
              onOpenFileReference={onOpenFileReference}
              memberIdentities={memberIdentities}
              onOpenTeamMember={onOpenTeamMember}
            />
          )}
          <StructuredAttachmentList
            attachments={message.attachments ?? []}
            mode="message"
            className={message.body.trim() === "" ? "" : "mt-2"}
          />
          {message.speaker === "agent"
          && message.runId !== null
          && onOpenOutput !== undefined ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => onOpenOutput({
                sessionId: message.sessionId,
                runId: message.runId!,
                stepId: message.runTiming?.stepId ?? null,
                role: message.role,
                fallbackOutput: message.body,
              })}
            >
              {t("console.common.fullOutput")}
            </Button>
          ) : null}
        </>
      )}
      </div>
    </article>
  );
}

function resolveMessageProcessRole(
  message: OperatorMessage,
  messages: readonly OperatorMessage[],
): string | null {
  if (message.role !== null) {
    return message.role;
  }
  const stepId = message.runTiming?.stepId;
  if (stepId === undefined) {
    return null;
  }
  return messages.find((candidate) =>
    candidate.role !== null && candidate.runTiming?.stepId === stepId)?.role ?? null;
}

function SubtaskStateMessage({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "danger";
}): JSX.Element {
  return (
    <p className={cn("py-8 text-center text-sm", tone === "danger" ? "text-danger" : "text-sub")}>
      {children}
    </p>
  );
}

function terminalOutcome(message: OperatorMessage): RunOutcomeStatus | null {
  if (message.terminal !== null && message.terminal !== undefined) {
    switch (message.terminal.kind) {
      case "interrupted":
        return message.terminal.subkind === "system" ? "system-stopped" : "user-stopped";
      case "timeout": return "run-stuck";
      case "quota-exhausted": return "quota-exhausted";
      case "rate-limited": return "rate-limited";
      case "auth": return "auth-failed";
      case "crashed": return "run-crashed";
    }
  }
  const eventKind = message.systemEventKind ?? message.sourceKind;
  if (
    eventKind === "run-not-started"
    || eventKind === "run-stuck"
    || eventKind === "user-stopped"
    || eventKind === "resume-unavailable"
    || eventKind === "retry-exhausted"
  ) {
    return eventKind;
  }
  return null;
}

function fallbackStatusLabel(
  status: OperatorSubSessionView["session"]["status"] | undefined,
  t: Translate,
): string {
  if (status === "running") return t("console.subtask.statusRunning");
  if (status === "waiting") return t("console.subtask.statusWaiting");
  if (status === "stuck") return t("console.subtask.statusStuck");
  if (status === "failed") return t("console.subtask.statusFailed");
  if (status === "interrupted") return t("console.subtask.statusInterrupted");
  if (status === "idle") return t("console.subtask.statusFinished");
  return t("console.subtask.statusUnknown");
}

function subtaskBadgeVariant(
  status: string | undefined,
): "running" | "waiting" | "completed" | "interrupted" | "failed" {
  switch (status) {
    case "running":
      return "running";
    case "waiting":
      return "waiting";
    case "finished":
    case "idle":
      return "completed";
    case "stopped":
    case "interrupted":
      return "interrupted";
    default:
      return "failed";
  }
}
