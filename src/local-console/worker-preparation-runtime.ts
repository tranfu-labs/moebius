import type { ActiveLocalRun } from "./active-run.js";
import { planLocalClaudeTerminalTrace } from "./claude-terminal-trace.js";
import type { LocalConsoleAgentFile } from "./agent-file.js";
import type { LocalCodexResumeMode } from "./codex-resume.js";
import type { LocalAgentSessionLinkFact, LocalExecutionRecoveryPlan, LocalRunExecutionContextFact } from "./execution-context.js";
import {
  executeLocalRunPreparationFlow,
  type LocalRunPreparationResult,
  type LocalRunRecoverySnapshot,
} from "./run-preparation-flow.js";
import {
  decideWorkerLifecycleCreation,
  decideWorkerOriginEffect,
  decideWorkerPreparation,
  decideWorkerWakeCheckpoint,
  planWorkerSourceDisposition,
  planWorkerProfile,
} from "./worker-runtime-plan.js";
import type { LocalWorkerRunInput } from "./worker-dispatch-runtime.js";
import type { LocalConsoleAgentTeamSnapshot, LocalConsoleMessage, LocalConsoleSessionSummary } from "./types.js";
import type { ResolvedLocalWorkspace } from "./workspace-source.js";

export interface LocalPreparedWorkerRun extends Extract<LocalRunPreparationResult, { kind: "ready" }> {
  runDir: string;
  controller: AbortController;
  activeRun: ActiveLocalRun;
}

export class LocalWorkerPreparationRuntime {
  constructor(private readonly input: {
    nowIso(): string;
    stopping(sessionId: string): boolean;
    releaseClaim(sourceMessage: LocalConsoleMessage, sessionId: string): Promise<void>;
    sessionSummary(sessionId: string): Promise<LocalConsoleSessionSummary>;
    makeRunDir(messageCount: number): string;
    setSourceRunDir(message: LocalConsoleMessage, sessionId: string, runDir: string): Promise<void>;
    resolveWorkspace(sessionId: string, source: LocalWorkerRunInput["workspaceSource"], signal: AbortSignal): Promise<ResolvedLocalWorkspace>;
    loadSelectedAgentMarkdown(selectedAgent: LocalConsoleAgentFile): Promise<string>;
    loadAgentContents(agentFiles: LocalConsoleAgentFile[], selectedAgent: LocalConsoleAgentFile, selectedMarkdown: string): Promise<Array<{
      name: string;
      agentMarkdown: string;
      executionProfile: LocalConsoleAgentFile["executionProfile"];
    }>>;
    loadTeamSnapshot(sessionId: string): Promise<LocalConsoleAgentTeamSnapshot | null>;
    loadRecoverySnapshot(sessionId: string): Promise<LocalRunRecoverySnapshot>;
    isCodexThreadAvailable(externalSessionId: string): Promise<boolean>;
    settleUnavailable(input: {
      sessionId: string;
      runId: string;
      sourceMessage: LocalConsoleMessage;
      role: string;
      runDir: string;
      unavailable: Extract<LocalExecutionRecoveryPlan, { kind: "unavailable" }>;
    }): Promise<void>;
    recordRunExecutionContext(context: LocalRunExecutionContextFact): Promise<void>;
    recordAgentSessionLink(link: LocalAgentSessionLinkFact): Promise<void>;
    prepareAttachments(input: { messages: LocalConsoleMessage[]; runDir: string }): Promise<{ promptSuffix: string; imagePaths: string[] }>;
    consumeRecoveryIntent(input: {
      sessionId: string;
      runId: string;
      intentId: string;
      mode: LocalCodexResumeMode;
      reason: string;
    }): Promise<void>;
    recordDetachedStarted(input: LocalWorkerRunInput, runDir: string): Promise<void>;
    prepareLifecycle(input: {
      sessionId: string;
      runId: string;
      stepId: string;
      resumeExisting: boolean;
    }): Promise<{ attempt: number; createdAt: string; startedAt: string | null; accumulatedMs: number; resuming: boolean }>;
    setActiveRun(runId: string, active: ActiveLocalRun): void;
    recordLifecycle(active: ActiveLocalRun): Promise<void>;
  }) {}

  async prepare(input: LocalWorkerRunInput): Promise<{ kind: "settled" } | LocalPreparedWorkerRun> {
    const origin = decideWorkerOriginEffect(input.origin);
    const policy = await this.input.sessionSummary(input.sessionId);
    const selectedMarkdown = await this.input.loadSelectedAgentMarkdown(input.selectedAgent);
    const runDir = this.input.makeRunDir(input.timelineMessages.length);
    if (origin.kind === "direct") await this.input.setSourceRunDir(input.sourceMessage, input.sessionId, runDir);
    const controller = new AbortController();
    const currentWorkspace = await this.input.resolveWorkspace(input.sessionId, input.workspaceSource, controller.signal);
    const afterWorkspace = decideWorkerWakeCheckpoint({ stopping: this.input.stopping(input.sessionId) });
    if (afterWorkspace.kind === "stop") {
      if (origin.kind === "direct") await this.input.releaseClaim(input.sourceMessage, input.sessionId);
      return { kind: "settled" };
    }
    const team = await this.input.loadAgentContents(input.agentFiles, input.selectedAgent, selectedMarkdown);
    const teamSnapshot = await this.input.loadTeamSnapshot(input.sessionId);
    const preparation = await executeLocalRunPreparationFlow({
      lane: "worker",
      sessionId: input.sessionId,
      runId: input.runId,
      sourceMessage: input.sourceMessage,
      role: input.role,
      defaultProfile: planWorkerProfile(input.selectedAgent.executionProfile),
      continuationEnded: input.selectedAgent.continuationEnded === true,
      defaultWorkspace: currentWorkspace,
      concurrentWorkspace: null,
      team: team.map((agent) => ({ ...agent, executionProfile: planWorkerProfile(agent.executionProfile) })),
      teamSnapshot,
      timeline: input.timeline,
      timelineMessages: input.timelineMessages,
      readOnly: policy.writePolicy === "confirm-current-plan-before-write",
      promptContract: "",
      runDir,
    }, {
      nowIso: () => this.input.nowIso(),
      loadRecoverySnapshot: () => this.input.loadRecoverySnapshot(input.sessionId),
      isCodexThreadAvailable: (externalSessionId) => this.input.isCodexThreadAvailable(externalSessionId),
      settleUnavailable: (unavailable) => this.input.settleUnavailable({ ...input, runDir, unavailable }),
      recordRunExecutionContext: (context) => this.input.recordRunExecutionContext(context),
      recordAgentSessionLink: (link) => this.input.recordAgentSessionLink(link),
      prepareAttachments: (attachmentInput) => this.input.prepareAttachments(attachmentInput),
      consumeRecoveryIntent: ({ intentId, mode, reason }) => this.input.consumeRecoveryIntent({
        sessionId: input.sessionId,
        runId: input.runId,
        intentId,
        mode,
        reason,
      }),
    });
    const preparationDecision = decideWorkerPreparation(preparation);
    if (preparationDecision.kind === "settled") return { kind: "settled" };
    const ready = preparationDecision.preparation;
    if (origin.kind === "detached") await this.input.recordDetachedStarted(input, runDir);
    const stepId = `message:${String(input.sourceMessage.id)}`;
    const lifecycle = await this.input.prepareLifecycle({
      sessionId: input.sessionId,
      runId: input.runId,
      stepId,
      resumeExisting: ready.continuingSameRun,
    });
    const activeRun: ActiveLocalRun = {
      sessionId: input.sessionId,
      runId: input.runId,
      userMessageId: input.sourceMessage.id,
      role: input.role,
      lane: "worker",
      sourceDisposition: planWorkerSourceDisposition(input.origin),
      runDir,
      cwd: ready.workspace.cwd,
      workspaceMode: ready.workspace.mode,
      worktreeUnavailableReason: ready.workspace.worktreeUnavailableReason,
      branchName: ready.workspace.branchName,
      baseRef: ready.workspace.baseRef,
      originalRepoRoot: ready.workspace.originalRepoRoot,
      liveMarkdown: null,
      activity: null,
      activitySteps: [],
      activitySequence: 0,
      activityFactTail: Promise.resolve(),
      longRunReported: false,
      createdAt: lifecycle.createdAt,
      startedAt: lifecycle.startedAt,
      segmentStartedAt: null,
      accumulatedMs: lifecycle.accumulatedMs,
      resuming: lifecycle.resuming,
      stepId,
      attempt: lifecycle.attempt,
      engine: ready.executionContext.engine,
      profile: ready.executionContext.profile,
      claudeTerminalTrace: planLocalClaudeTerminalTrace(ready.executionContext.engine),
      processOutputAvailable: true,
      terminalRecorded: false,
      controller,
      threadId: null,
      gracefulResumePrepared: false,
    };
    const beforeActivation = decideWorkerWakeCheckpoint({ stopping: this.input.stopping(input.sessionId) });
    if (beforeActivation.kind === "stop") {
      if (origin.kind === "direct") await this.input.releaseClaim(input.sourceMessage, input.sessionId);
      return { kind: "settled" };
    }
    this.input.setActiveRun(input.runId, activeRun);
    const lifecycleCreation = decideWorkerLifecycleCreation(lifecycle.resuming);
    if (lifecycleCreation.kind === "record") await this.input.recordLifecycle(activeRun);
    return { ...ready, runDir, controller, activeRun };
  }
}
