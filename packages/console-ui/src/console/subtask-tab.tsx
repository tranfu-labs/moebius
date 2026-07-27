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
import { RoleTag } from "@/console/role-tag";
import { RunBlock } from "@/console/run-block";
import { RunOutcome, type RunOutcomeStatus } from "@/console/run-outcome";
import { RunTime } from "@/console/run-time";
import { StructuredAttachmentList, type ComposerAttachment } from "@/console/structured-attachments";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { resolveOperatorMemberName } from "@/console/member-name";

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
  onRetry(runId: string): void;
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
  onInterrupt,
  onOpenOutput,
  onOpenExternalLink,
  onOpenFileReference,
  onOpenTeamMember,
  className,
}: SubtaskTabProps): JSX.Element {
  const view = state.status === "ready" ? state.view : null;
  const activeRun = view?.activeRun ?? null;
  const memberIdentities = view?.memberIdentities ?? [];
  const continuationBlocked = view?.session.continuation?.canContinue === false;
  const disabled = sending || continuationBlocked || state.status !== "ready";
  const title = summary?.title ?? view?.session.title ?? "子任务";
  const memberName = summary?.memberName ?? resolveOperatorMemberName(
    activeRun?.role ?? view?.messages.find((message) => message.speaker === "agent")?.role ?? null,
    memberIdentities,
    "成员未知",
  );
  const statusLabel = summary?.statusLabel ?? fallbackStatusLabel(view?.session.status);

  return (
    <section
      className={cn("flex min-h-full flex-col", className)}
      aria-label={`子任务：${title}`}
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
          关闭标签只会关闭这个视图，不会取消子任务。
        </p>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-auto px-5 pb-4">
        {state.status === "error" ? (
          <SubtaskStateMessage tone="danger">{state.message}</SubtaskStateMessage>
        ) : view === null ? (
          <SubtaskStateMessage>正在加载子任务内容…</SubtaskStateMessage>
        ) : (
          <div>
            {view.messages.length === 0 && activeRun === null ? (
              <SubtaskStateMessage>这个子任务还没有推进内容。</SubtaskStateMessage>
            ) : null}
            {view.messages.map((message) => (
              <SubtaskTimelineEntry
                key={message.id}
                message={message}
                processRole={resolveMessageProcessRole(message, view.messages)}
                memberIdentities={memberIdentities}
                onRetry={onRetry}
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
                  processOutputAvailable={activeRun.processOutputAvailable}
                  outputUnavailableMessage="完整输出不可用 · 当前 Kimi 执行不提供可恢复的完整过程记录"
                  summary={activeRun.lastOutputSummary}
                  liveMarkdown={activeRun.liveMarkdown}
                  rawOutput={activeRun.stderrTail ?? activeRun.stdoutTail}
                  onOpenExternalLink={onOpenExternalLink}
                  onOpenFileReference={onOpenFileReference}
                  onOpenTeamMember={onOpenTeamMember}
                  onOpenOutput={onOpenOutput === undefined || activeRun.processOutputAvailable === false
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
                  interruptLabel={`停下${resolveOperatorMemberName(activeRun.role, memberIdentities, "当前这一步")}`}
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
            ? view?.session.continuation?.reason ?? "当前子任务暂时不能继续"
            : activeRun
              ? "说点什么，或 @ 一个成员…"
              : "推进这个子任务，或 @ 一个成员…"}
          statusText={continuationBlocked
            ? view?.session.continuation?.reason ?? "当前子任务暂时不能继续"
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
  onOpenOutput,
  onOpenExternalLink,
  onOpenFileReference,
  onOpenTeamMember,
}: {
  message: OperatorMessage;
  processRole: string | null;
  memberIdentities: NonNullable<OperatorSubSessionView["memberIdentities"]>;
  onRetry(runId: string): void;
  onOpenOutput?: SubtaskTabProps["onOpenOutput"];
  onOpenExternalLink?: (url: string) => void;
  onOpenFileReference?: (reference: MarkdownFileReference) => void;
  onOpenTeamMember?: (slug: string) => void;
}): JSX.Element {
  const outcome = terminalOutcome(message);
  if (outcome !== null) {
    return (
      <RunOutcome
        status={outcome}
        role={processRole}
        memberIdentities={memberIdentities}
        rawReason={message.error ?? message.body}
        rawOutput={message.error ?? message.body}
        elapsedMs={message.runTiming?.elapsedMs}
        completedAt={message.runTiming?.completedAt}
        onRetry={(outcome === "run-not-started" || outcome === "run-stuck" || outcome === "resume-unavailable") && message.runId !== null
          ? () => onRetry(message.runId!)
          : undefined}
        onOpenOutput={message.runId === null
          || onOpenOutput === undefined
          || message.runTiming?.processOutputAvailable === false
          ? undefined
          : (fallbackOutput) => onOpenOutput({
              sessionId: message.sessionId,
              runId: message.runId!,
              stepId: message.runTiming?.stepId ?? null,
              role: processRole,
              fallbackOutput,
            })}
        className="py-4"
      />
    );
  }

  if (message.speaker === "user") {
    return (
      <article className="py-4 text-sm">
        <div className="mb-1.5 flex items-center justify-end gap-2 text-[12.5px] text-sub">
          <span className="font-semibold text-ink">你</span>
          <RoleTag label="你" toneKey="user" />
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
            label={resolveOperatorMemberName(message.role, memberIdentities)}
            toneKey={message.role ?? "agent"}
          />
        ) : null}
        <span className="font-semibold text-ink">
          {message.speaker === "agent"
            ? resolveOperatorMemberName(message.role, memberIdentities)
            : "系统提示"}
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
          && onOpenOutput !== undefined
          && message.runTiming?.processOutputAvailable !== false ? (
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
              完整输出
            </Button>
          ) : null}
          {message.speaker === "agent" && message.runTiming?.processOutputAvailable === false ? (
            <p className="mt-2 text-xs text-hint">
              完整输出不可用 · 当前 Kimi 执行不提供可恢复的完整过程记录
            </p>
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

function fallbackStatusLabel(status: OperatorSubSessionView["session"]["status"] | undefined): string {
  if (status === "running") return "进行中";
  if (status === "waiting") return "等待中";
  if (status === "stuck") return "卡住了";
  if (status === "failed") return "没跑起来";
  if (status === "interrupted") return "已停下";
  if (status === "idle") return "已结束";
  return "状态未知";
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
