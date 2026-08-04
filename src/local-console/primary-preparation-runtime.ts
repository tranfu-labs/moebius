import type { TimelineMessage } from "../conversation.js";
import type { ActiveLocalRun } from "./active-run.js";
import type { LocalConsoleAgentFile } from "./agent-file.js";
import type { LocalCodexResumeMode } from "./codex-resume.js";
import type { LocalAgentSessionLinkFact, LocalExecutionRecoveryPlan, LocalRunExecutionContextFact } from "./execution-context.js";
import {
  decidePrimaryAnalysisContract,
  decidePrimaryLifecycleCreation,
  decidePrimaryInactive,
  decidePrimaryPreparation,
  planPrimaryProfile,
} from "./primary-runtime-plan.js";
import {
  executeLocalRunPreparationFlow,
  type LocalRunPreparationResult,
  type LocalRunRecoverySnapshot,
} from "./run-preparation-flow.js";
import type { LocalConsoleAgentTeamSnapshot, LocalConsoleMessage, LocalConsoleSessionWorkspaceSource } from "./types.js";
import type { ResolvedLocalWorkspace } from "./workspace-source.js";

export interface LocalPrimaryRunInput {
  sessionId: string;
  runId: string;
  sourceMessage: LocalConsoleMessage;
  role: string;
  primaryAgent: string | null;
  selectedAgent: LocalConsoleAgentFile;
  agentFiles: LocalConsoleAgentFile[];
  timeline: TimelineMessage[];
  timelineMessages: LocalConsoleMessage[];
  workspaceSource: LocalConsoleSessionWorkspaceSource;
  analysisGateEnabled: boolean;
  proposalVersion: string | null;
}

export interface LocalPreparedPrimaryRun extends Extract<LocalRunPreparationResult, { kind: "ready" }> {
  providerRunDir: string;
  resolvedRunDir: string;
  controller: AbortController;
  activeRun: ActiveLocalRun;
}

export class LocalPrimaryPreparationRuntime {
  constructor(private readonly input: {
    nowIso(): string;
    inactive(sessionId: string): boolean;
    loadSelectedAgentMarkdown(agent: LocalConsoleAgentFile): Promise<string>;
    makeRunDir(messageCount: number): { providerRunDir: string; resolvedRunDir: string };
    setSourceRunDir(message: LocalConsoleMessage, sessionId: string, runDir: string): Promise<void>;
    resolveWorkspace(sessionId: string, source: LocalConsoleSessionWorkspaceSource, signal: AbortSignal): Promise<ResolvedLocalWorkspace>;
    loadAgentContents(agents: LocalConsoleAgentFile[], selected: LocalConsoleAgentFile, selectedMarkdown: string): Promise<Array<{
      name: string;
      agentMarkdown: string;
      executionProfile: LocalConsoleAgentFile["executionProfile"];
    }>>;
    loadTeamSnapshot(sessionId: string): Promise<LocalConsoleAgentTeamSnapshot | null>;
    concurrentRecoveryWorkspace(sessionId: string): ResolvedLocalWorkspace | null;
    buildAnalysisContract(proposalVersion: string | null): string;
    loadRecoverySnapshot(sessionId: string): Promise<LocalRunRecoverySnapshot>;
    isCodexThreadAvailable(externalSessionId: string): Promise<boolean>;
    settleUnavailable(input: LocalPrimaryRunInput & {
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
    prepareLifecycle(input: { sessionId: string; runId: string; stepId: string; resumeExisting: boolean }): Promise<{
      attempt: number;
      createdAt: string;
      startedAt: string | null;
      accumulatedMs: number;
      resuming: boolean;
    }>;
    setActiveRun(runId: string, active: ActiveLocalRun): void;
    recordLifecycle(active: ActiveLocalRun): Promise<void>;
  }) {}

  async prepare(
    input: LocalPrimaryRunInput,
    onRunDir: (runDir: string) => void,
  ): Promise<{ kind: "settled" } | LocalPreparedPrimaryRun> {
    const selectedMarkdown = await this.input.loadSelectedAgentMarkdown(input.selectedAgent);
    const dirs = this.input.makeRunDir(input.timelineMessages.length);
    onRunDir(dirs.providerRunDir);
    await this.input.setSourceRunDir(input.sourceMessage, input.sessionId, dirs.resolvedRunDir);
    const controller = new AbortController();
    const workspace = await this.input.resolveWorkspace(input.sessionId, input.workspaceSource, controller.signal);
    const workspaceCheckpoint = decidePrimaryInactive(this.input.inactive(input.sessionId));
    if (workspaceCheckpoint.kind === "stop") return { kind: "settled" };
    const team = await this.input.loadAgentContents(input.agentFiles, input.selectedAgent, selectedMarkdown);
    const teamSnapshot = await this.input.loadTeamSnapshot(input.sessionId);
    const contractDecision = decidePrimaryAnalysisContract(input);
    const promptContract = contractDecision.kind === "include"
      ? this.input.buildAnalysisContract(input.proposalVersion)
      : "";
    const preparationDecision = decidePrimaryPreparation(await executeLocalRunPreparationFlow({
      lane: "primary",
      sessionId: input.sessionId,
      runId: input.runId,
      sourceMessage: input.sourceMessage,
      role: input.role,
      defaultProfile: planPrimaryProfile(input.selectedAgent.executionProfile),
      defaultWorkspace: workspace,
      concurrentWorkspace: this.input.concurrentRecoveryWorkspace(input.sessionId),
      team: team.map((agent) => ({ ...agent, executionProfile: planPrimaryProfile(agent.executionProfile) })),
      teamSnapshot,
      timeline: input.timeline,
      timelineMessages: input.timelineMessages,
      readOnly: input.analysisGateEnabled,
      promptContract,
      runDir: dirs.resolvedRunDir,
    }, {
      nowIso: () => this.input.nowIso(),
      loadRecoverySnapshot: () => this.input.loadRecoverySnapshot(input.sessionId),
      isCodexThreadAvailable: (id) => this.input.isCodexThreadAvailable(id),
      settleUnavailable: (unavailable) => this.input.settleUnavailable({ ...input, runDir: dirs.resolvedRunDir, unavailable }),
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
    }));
    if (preparationDecision.kind === "settled") return { kind: "settled" };
    const ready = preparationDecision.preparation;
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
      lane: "primary",
      sourceDisposition: "primary",
      runDir: dirs.resolvedRunDir,
      cwd: ready.workspace.cwd,
      workspaceMode: ready.workspace.mode,
      worktreeUnavailableReason: ready.workspace.worktreeUnavailableReason,
      branchName: ready.workspace.branchName,
      baseRef: ready.workspace.baseRef,
      originalRepoRoot: ready.workspace.originalRepoRoot,
      liveMarkdown: null,
      activity: null,
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
      processOutputAvailable: true,
      terminalRecorded: false,
      controller,
      threadId: null,
      gracefulResumePrepared: false,
    };
    this.input.setActiveRun(input.runId, activeRun);
    const lifecycleCreation = decidePrimaryLifecycleCreation(lifecycle.resuming);
    if (lifecycleCreation.kind === "record") await this.input.recordLifecycle(activeRun);
    return { ...ready, providerRunDir: dirs.providerRunDir, resolvedRunDir: dirs.resolvedRunDir, controller, activeRun };
  }
}
