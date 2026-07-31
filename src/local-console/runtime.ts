import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { parseAgentManifest } from "../agent-manifest.js";
import { loadCeoScripts } from "../ceo-scripts.js";
import {
  CEO_ORCHESTRATION_STAGE,
  parseCeoOrchestrationOutput,
  type CeoChildIssueDescriptor,
  type CeoOrchestrationGroup,
} from "../ceo-orchestration.js";
import {
  type CodexRunOptions,
  type CodexRunResult,
  executionInterruptionCauseForResult,
  executionTimeoutKind,
  isInterruptedCodexRunResult,
} from "../codex.js";
import { log } from "../log.js";
import { parseTrailingStageMarker } from "../stages.js";
import { isTrustedExecutionProfile } from "../execution-profile-registry.js";
import { LOCAL_LONG_RUN_REPORT_MS } from "../config.js";
import type { ExecutionProgressEvent } from "../execution-contract.js";
import { resolveTrigger } from "../triggers/index.js";
import { readLocalConsoleOutputTail } from "./output-tail.js";
import {
  chooseLatestRunActivity,
  projectAgentProgressActivity,
  projectStructuredRunActivity,
  type LocalRunActivity,
} from "./run-activity.js";
import { listLocalChildSessionSummaries } from "./child-session-summary.js";
import { maybeRouteLocalNoMentionMessage, type LocalRouteJudgment } from "./route-bus.js";
import {
  buildLocalAgentDeltaPrompt,
  buildLocalAgentPrompt,
  selectLocalTimelineDelta,
} from "./prompt.js";
import type { LocalAttachmentManager } from "./attachments.js";
import {
  buildLocalConsoleRoutingTimeline,
  buildLocalConsoleTimeline,
} from "./timeline.js";
import { deriveSessionTitle } from "./title.js";
import {
  LOCAL_CONSOLE_DEFAULT_SESSION_ID,
  LOCAL_CONSOLE_PROJECT_ID,
  LocalConsoleBusyError,
  LocalConsoleProjectFolderError,
  LocalConsoleStoreTimeoutError,
  type LocalConsoleFileContent,
  type LocalConsoleMessage,
  type LocalConsoleProjectFiles,
  type LocalConsoleSystemEventKind,
  type LocalConsoleProjectSummary,
  type LocalConsoleProjectRemovalResult,
  LocalConsoleProjectRunningError,
  type LocalConsoleSessionArchiveResult,
  LocalConsoleSessionRunningError,
  LocalConsoleSessionWorkspaceLockedError,
  type LocalConsoleRunSnapshot,
  type LocalConsoleRunOutput,
  type LocalConsoleSessionSummary,
  type LocalConsoleSessionSearchResult,
  type LocalConsoleSessionReferenceText,
  type LocalConsoleSessionReferenceScope,
  type LocalConsoleSessionWorkspaceSource,
  type LocalConsoleWorkspaceMode,
  type LocalConsoleAgentTeamOwnership,
  type LocalConsoleAgentTeamSnapshot,
  type LocalConsoleExecutionProfile,
  type LocalConsoleSnapshot,
  type LocalConsoleStateSnapshot,
  type LocalConsoleSessionView,
  type LocalConsoleWorkspaceDiffDetail,
  type LocalConsoleWorkspaceDiffSummary,
  type LocalConsoleStore,
  type LocalConsoleEntryTemplate,
  type LocalConsoleWritePolicy,
  type LocalConsoleTextFragment,
  type LocalConsoleTerminal,
} from "./types.js";
import {
  buildMoebiusReferenceText,
  extractMoebiusReferences,
  plainTextExcerpt,
  serializeTextFragmentReferences,
} from "./session-reference-text.js";
import {
  createLocalExecutionRunner,
  type LocalExecutionRunner,
} from "./execution-driver.js";
import {
  createRunExecutionContext,
  singleRunOverrideIdentitySalt,
  latestAgentTimelineCursor,
  legacyCodexContextFingerprint,
  planLocalExecutionRecovery,
  readAgentSessionLinks,
  readAgentTimelineCursors,
  readExecutionSessionLinks,
  readProviderSessionObservations,
  readRunExecutionContexts,
  type LocalAgentSessionLinkFact,
  type LocalAgentTimelineCursorFact,
  type LocalExecutionSessionLinkFact,
  type LocalProviderInvocationFact,
  type LocalProviderSessionObservedFact,
  type LocalRunExecutionContextFact,
} from "./execution-context.js";
import { projectLocalConsoleMemberIdentities } from "./member-identity.js";
import { resolveLocalUserMessageDispatch } from "./user-message-routing.js";
import {
  generateLocalWorkspaceDiff,
  invalidateLocalWorkspaceFacts,
  localSessionWorktreePath,
  readCachedLocalWorkspaceFacts,
  readLocalGitStatus,
  resolveLocalWorkspaceSource,
  type ResolvedLocalWorkspace,
} from "./workspace-source.js";
import {
  readLocalConversationBaselineCommit,
  readLocalConversationDiffFile,
  readLocalConversationWorkspaceDiff,
  readLocalConversationWorkspaceDiffDetail,
} from "./workspace-diff.js";
import {
  listLocalWorkspaceFiles,
  readLocalFileReferenceWindow,
  readLocalWorkspaceTextFile,
} from "./file-read.js";
import { resolveSessionWorkspaceContext } from "./workspace-resolution.js";
import { nonContinuableSystemMessage, resolveLocalSessionContinuation } from "./session-status.js";
import { ORPHAN_RUN_STUCK_REASON, identifyOrphanRuns } from "./orphan-runs.js";
import { readCodexThreadLinks } from "./codex-thread-link.js";
import {
  buildLocalResumePrompt,
  readLocalCodexRecoveryFacts,
  type LocalCodexResumeConsumedFact,
  type LocalCodexResumeIntentFact,
  type LocalCodexRunUsageFact,
  type LocalRunSourceDisposition,
} from "./codex-resume.js";
import {
  loadLocalProcessAppendPage,
  loadLocalProcessDebugInvocation,
  loadLocalProcessHistoryPage,
  type LocalConsoleProcessDebugInvocation,
  type LocalConsoleProcessAppendPage,
  type LocalConsoleProcessHistoryPage,
} from "./process-history.js";
import { resolveCodexRollout } from "./codex-rollout.js";
import {
  buildConfirmedPlanExecutionPrompt,
  buildSessionAnalysisReadOnlyContract,
  parseSessionAnalysisResponse,
} from "./session-analysis-gate.js";

export interface LocalConsoleAgentFile {
  name: string;
  path?: string;
  agentMarkdown?: string;
  executionProfile?: LocalConsoleExecutionProfile | null;
}

export interface LocalConsoleRuntimeOptions {
  store: LocalConsoleStore;
  listAgentFiles: (sessionId: string) => Promise<LocalConsoleAgentFile[]>;
  loadAgentTeamSnapshot?: (
    binding: { ownership: LocalConsoleAgentTeamOwnership; id: string },
  ) => Promise<LocalConsoleAgentTeamSnapshot>;
  resolveAgentTeamHealth?: (
    session: LocalConsoleSessionSummary,
  ) => Promise<{ health: "usable" | "deleted" | "needs-repair"; reason: string | null }>;
  runCodex: (options: CodexRunOptions) => Promise<CodexRunResult>;
  runExecution?: LocalExecutionRunner;
  makeRunDir: (count: number, now?: Date) => string;
  dataRoot?: string;
  projectRoot: string;
  workdirRoot: string;
  sessionId?: string;
  storeTimeoutMs?: number;
  codexIdleTimeoutMs?: number;
  toolInFlightTimeoutMs?: number;
  codexMaxDurationMs?: number;
  workspaceGitTimeoutMs?: number;
  staleRunningGraceMs?: number;
  routeJudgment?: LocalRouteJudgment;
  routeTimeoutMs?: number;
  failureRetryLimit?: number;
  attachmentManager?: LocalAttachmentManager;
  isCodexThreadAvailable?: (threadId: string) => Promise<boolean>;
  now?: () => Date;
}

interface RunLifecycleFactStore extends LocalConsoleStore {
  nextRunAttempt(input: { sessionId: string; stepId: string }): Promise<number>;
  getRunTiming(input: {
    sessionId: string;
    runId: string;
  }): Promise<import("./types.js").LocalConsoleRunTiming | null>;
  recordRunLifecycleEvent(input: {
    sessionId: string;
    runId: string;
    stepId: string;
    attempt: number;
    phase: "created" | "started" | "paused" | "resumed" | "terminal";
    role: string | null;
    engine: "codex" | "claude" | "kimi";
    processOutputAvailable: boolean;
    createdAt: string;
    startedAt: string | null;
    elapsedMs: number | null;
    completedAt: string | null;
    status: import("./types.js").LocalConsoleRunTiming["status"];
    recordedAt: string;
  }): Promise<void>;
  recordRunActivityEvent(input: {
    sessionId: string;
    runId: string;
    activity: LocalRunActivity;
  }): Promise<void>;
}

interface SessionFactWritingStore extends LocalConsoleStore {
  getSessionFactLogPath(sessionId: string): string;
  recordProgressEvent(input: {
    sessionId: string;
    runId: string;
    role: string;
    body: string;
    now: string;
  }): Promise<void>;
  createChildSession(input: {
    parentSessionId: string;
    childSessionId: string;
    projectId: string;
    title: string;
    relation: string;
    hiddenKey: string;
    initialBody: string;
    initialRole: string | null;
    now: string;
  }): Promise<LocalConsoleSessionSummary>;
  recordChildSessionCard(input: {
    parentSessionId: string;
    sourceId: string;
    childSessionIds: string[];
    runId: string;
    runDir: string;
    now: string;
  }): Promise<void>;
  recordWorkspaceDiff(input: {
    sessionId: string;
    runId: string;
    originalRepoRoot: string | null;
    baseRef: string;
    branchName: string;
    worktreePath: string;
    patchPath: string;
    affectedFiles: string[];
    status: "generated" | "applied" | "failed" | "abandoned" | "rolled_back";
    error: string | null;
    now: string;
  }): Promise<void>;
}

interface CodexRecoveryFactStore extends LocalConsoleStore {
  getSessionFactLogPath(sessionId: string): string;
  recordCodexResumeIntent(input: LocalCodexResumeIntentFact): Promise<void>;
  recordCodexResumeConsumed(input: LocalCodexResumeConsumedFact): Promise<void>;
  recordCodexRunUsage(input: LocalCodexRunUsageFact): Promise<void>;
  recordAgentSessionLink(input: LocalAgentSessionLinkFact): Promise<void>;
  recordProviderSessionObserved(input: LocalProviderSessionObservedFact): Promise<void>;
  recordAgentTimelineCursor(input: LocalAgentTimelineCursorFact): Promise<void>;
  recordProviderInvocation(input: LocalProviderInvocationFact): Promise<void>;
}

interface ActiveLocalRun {
  sessionId: string;
  runId: string;
  userMessageId: number;
  role: string | null;
  lane: "primary" | "worker";
  sourceDisposition: LocalRunSourceDisposition;
  runDir: string | null;
  cwd: string | null;
  workspaceMode: "direct" | "worktree" | null;
  worktreeUnavailableReason: string | null;
  branchName: string | null;
  baseRef: string | null;
  originalRepoRoot: string | null;
  liveMarkdown: string | null;
  activity: LocalRunActivity | null;
  activitySequence: number;
  activityFactTail: Promise<void>;
  longRunReported: boolean;
  createdAt: string;
  startedAt: string | null;
  segmentStartedAt: string | null;
  accumulatedMs: number;
  resuming: boolean;
  stepId: string;
  attempt: number;
  engine: "codex" | "claude" | "kimi";
  profile: LocalConsoleExecutionProfile | null;
  processOutputAvailable: boolean;
  terminalRecorded: boolean;
  controller: AbortController;
  threadId: string | null;
  gracefulResumePrepared: boolean;
}

export class LocalConsoleRuntime {
  private readonly sessionId: string;
  private readonly storeTimeoutMs: number;
  private readonly codexIdleTimeoutMs?: number;
  private readonly toolInFlightTimeoutMs?: number;
  private readonly codexMaxDurationMs?: number;
  private readonly routeTimeoutMs?: number;
  private readonly staleRunningGraceMs: number;
  private readonly now: () => Date;
  private readonly executionRunner: LocalExecutionRunner;
  private readonly processingSessions = new Set<string>();
  private readonly pendingProcessSessions = new Set<string>();
  private readonly workerWakeTasks = new Set<Promise<void>>();
  private readonly workerLaneTails = new Map<string, Promise<void>>();
  private readonly activeRuns = new Map<string, ActiveLocalRun>();
  private readonly retryAdmissions = new Map<string, Promise<boolean>>();
  private readonly inactiveSessions = new Set<string>();
  private readonly conversationBaselineCommits = new Map<string, string | null>();
  private closing = false;
  private lastError: string | null = null;

  constructor(private readonly options: LocalConsoleRuntimeOptions) {
    this.sessionId = options.sessionId ?? LOCAL_CONSOLE_DEFAULT_SESSION_ID;
    this.storeTimeoutMs = options.storeTimeoutMs ?? 2_000;
    this.codexIdleTimeoutMs = options.codexIdleTimeoutMs;
    this.toolInFlightTimeoutMs = options.toolInFlightTimeoutMs;
    this.codexMaxDurationMs = options.codexMaxDurationMs;
    this.routeTimeoutMs = options.routeTimeoutMs;
    this.staleRunningGraceMs = options.staleRunningGraceMs ?? 5_000;
    this.now = options.now ?? (() => new Date());
    this.executionRunner = options.runExecution ?? createLocalExecutionRunner({
      dataRoot: options.dataRoot ?? options.projectRoot,
      runCodex: options.runCodex,
    });
  }

  get sqlitePath(): string {
    return this.options.store.sqlitePath;
  }

  async init(): Promise<void> {
    await this.options.store.init();
    const sessions = await this.storeCall("local-console-store-list-sessions", () => this.options.store.listSessions());
    const sessionIds = sessions.length === 0
      ? [this.sessionId]
      : sessions.map((session) => session.sessionId);
    const pendingSessionIds = new Set(
      sessions.filter(hasPendingStartupControlWork).map((session) => session.sessionId),
    );
    await Promise.all(sessionIds.map(async (sessionId) => {
      let startupMessages: LocalConsoleMessage[] | undefined;
      let knownRecoveryFacts:
        | Awaited<ReturnType<typeof readLocalCodexRecoveryFacts>>
        | undefined;
      const hasProjectedStartupWork = sessions.length === 0 || pendingSessionIds.has(sessionId);
      let hasLegacyRepairCandidate = hasProjectedStartupWork;
      if (!hasProjectedStartupWork) {
        const recoveryStore = this.codexRecoveryFactStore();
        if (recoveryStore !== null) {
          knownRecoveryFacts = await readLocalCodexRecoveryFacts(
            recoveryStore.getSessionFactLogPath(sessionId),
            sessionId,
          );
          const recoveryFacts = knownRecoveryFacts;
          hasLegacyRepairCandidate = recoveryFacts.intents.some((intent) =>
            intent.reason === "graceful-shutdown"
            && intent.sourceDisposition === undefined
            && !recoveryFacts.consumedIntentIds.has(intent.intentId)
            && !recoveryFacts.repairedIntentIds.has(intent.intentId));
        }
      }
      if (hasProjectedStartupWork) {
        try {
          startupMessages = await this.claimOrphanRuns(sessionId);
        } catch (error) {
          this.lastError = formatLocalError(error);
          log({ event: "local-console-claim-orphan-runs-failed", sessionId, error: this.lastError });
        }
      }
      if (hasLegacyRepairCandidate) {
        try {
          await this.repairLegacyAgentHandoffResumeSources(
            sessionId,
            startupMessages,
            knownRecoveryFacts,
          );
        } catch (error) {
          this.lastError = formatLocalError(error);
          log({ event: "local-console-repair-agent-handoff-resume-failed", sessionId, error: this.lastError });
        }
      }
      if (hasProjectedStartupWork) {
        try {
          await this.repairStaleRunning(sessionId);
        } catch (error) {
          this.lastError = formatLocalError(error);
          log({ event: "local-console-repair-stale-failed", sessionId, error: this.lastError });
        }
      }
    }));
  }

  private async claimOrphanRuns(sessionId: string): Promise<LocalConsoleMessage[]> {
    const messages = await this.storeCall("local-console-store-list-messages", () =>
      this.options.store.listMessages(sessionId),
    );
    const activeSessionIds = new Set(
      [...this.activeRuns.values()].map((active) => active.sessionId),
    );
    const orphans = identifyOrphanRuns({ sessionId, messages, activeSessionIds });
    const recoveryStore = this.codexRecoveryFactStore();
    const recoveryFacts = recoveryStore === null
      ? { intents: [], consumedIntentIds: new Set<string>(), repairedIntentIds: new Set<string>() }
      : await readLocalCodexRecoveryFacts(recoveryStore.getSessionFactLogPath(sessionId), sessionId);
    for (const orphan of orphans) {
      try {
        const gracefulIntent = recoveryFacts.intents.find((intent) =>
          intent.targetRunId === orphan.runId
          && intent.reason === "graceful-shutdown"
          && !recoveryFacts.consumedIntentIds.has(intent.intentId));
        if (gracefulIntent !== undefined) {
          if (orphan.userMessageId !== gracefulIntent.sourceMessageId) {
            await this.storeCall("local-console-store-release-graceful-worker-placeholder", () =>
              this.options.store.releaseMessageForRetry({
                userMessageId: orphan.userMessageId,
                sessionId,
                now: this.nowIso(),
              }));
          }
          const source = messages.find((message) => message.id === gracefulIntent.sourceMessageId);
          const sourceDisposition = gracefulIntent.sourceDisposition;
          if (sourceDisposition !== undefined) {
            const releaseMessageForResume = this.options.store.releaseMessageForResume;
            if (releaseMessageForResume === undefined) {
              throw new Error("local console graceful resume persistence capability unavailable");
            }
            await this.storeCall("local-console-store-release-graceful-resume", () =>
              releaseMessageForResume.call(this.options.store, {
                userMessageId: gracefulIntent.sourceMessageId,
                sessionId,
                sourceDisposition,
                targetRunId: gracefulIntent.targetRunId,
                role: gracefulIntent.role,
                now: this.nowIso(),
              }));
          }
          continue;
        }
        await this.storeCall("local-console-store-record-stuck", () =>
          this.options.store.recordStuck({
            userMessageId: orphan.userMessageId,
            sessionId,
            reason: ORPHAN_RUN_STUCK_REASON,
            runId: orphan.runId,
            runDir: orphan.runDir,
            now: this.nowIso(),
          }),
        );
      } catch (error) {
        this.lastError = formatLocalError(error);
        log({
          event: "local-console-record-orphan-stuck-failed",
          sessionId,
          userMessageId: orphan.userMessageId,
          error: this.lastError,
        });
      }
    }
    return messages;
  }

  private async repairLegacyAgentHandoffResumeSources(
    sessionId: string,
    startupMessages?: LocalConsoleMessage[],
    knownRecoveryFacts?: Awaited<ReturnType<typeof readLocalCodexRecoveryFacts>>,
  ): Promise<void> {
    const recoveryStore = this.codexRecoveryFactStore();
    const repairSource = this.options.store.repairAgentHandoffResumeSource;
    if (recoveryStore === null || repairSource === undefined) {
      return;
    }
    const factLogPath = recoveryStore.getSessionFactLogPath(sessionId);
    const [messages, recoveryFacts, runContexts] = await Promise.all([
      startupMessages ?? this.storeCall("local-console-store-list-messages", () =>
        this.options.store.listMessages(sessionId)),
      knownRecoveryFacts ?? readLocalCodexRecoveryFacts(factLogPath, sessionId),
      readRunExecutionContexts(factLogPath, sessionId),
    ]);
    const unconsumedIntents = recoveryFacts.intents.filter((intent) =>
      !recoveryFacts.consumedIntentIds.has(intent.intentId));
    const unconsumedGracefulIntents = unconsumedIntents.filter((intent) =>
      intent.reason === "graceful-shutdown");

    for (const intent of unconsumedGracefulIntents) {
      if (
        recoveryFacts.repairedIntentIds.has(intent.intentId)
      ) {
        continue;
      }
      const source = messages.find((message) => message.id === intent.sourceMessageId);
      if (source?.status === "displayed") {
        continue;
      }
      if (
        intent.sourceDisposition !== undefined
        && intent.sourceDisposition !== "agent-handoff"
        && source?.speaker !== "agent"
      ) {
        continue;
      }
      const rejection = (() => {
        if (
          intent.sourceDisposition !== undefined
          && intent.sourceDisposition !== "agent-handoff"
        ) {
          return "source disposition is not agent-handoff";
        }
        const competingIntents = unconsumedGracefulIntents.filter((candidate) =>
          candidate.sourceMessageId === intent.sourceMessageId
          || candidate.targetRunId === intent.targetRunId);
        if (
          competingIntents.length !== 1
          || competingIntents[0]?.intentId !== intent.intentId
        ) {
          return "resume intent is not unique for its source and run";
        }
        if (
          source === undefined
          || source.speaker !== "agent"
          || source.sourceKind !== "local-message"
          || source.status !== "pending"
        ) {
          return "exact source is not an Agent pending local message";
        }
        const relatedContexts = runContexts.filter((context) =>
          context.runId === intent.targetRunId
          || context.sourceMessageId === intent.sourceMessageId);
        if (
          relatedContexts.length !== 1
          || relatedContexts[0]?.sessionId !== sessionId
          || relatedContexts[0]?.runId !== intent.targetRunId
          || relatedContexts[0]?.sourceMessageId !== intent.sourceMessageId
          || relatedContexts[0]?.role !== intent.role
        ) {
          return "run execution context is missing, conflicting, or not exact";
        }
        if (this.activeRuns.has(intent.targetRunId)) {
          return "target run is active in this process";
        }
        return null;
      })();
      if (rejection !== null) {
        log({
          event: "local-console-agent-handoff-resume-repair-rejected",
          sessionId,
          intentId: intent.intentId,
          targetRunId: intent.targetRunId,
          sourceMessageId: intent.sourceMessageId,
          reason: rejection,
        });
        continue;
      }
      await this.storeCall("local-console-store-repair-agent-handoff-resume-source", () =>
        repairSource.call(this.options.store, {
          sessionId,
          intentId: intent.intentId,
          targetRunId: intent.targetRunId,
          sourceMessageId: intent.sourceMessageId,
          role: intent.role,
          now: this.nowIso(),
        }));
    }
  }

  async close(): Promise<void> {
    if (this.closing) {
      return;
    }
    this.closing = true;
    this.pendingProcessSessions.clear();
    for (const active of [...this.activeRuns.values()]) {
      try {
        if (active.threadId !== null) {
          const intent: LocalCodexResumeIntentFact = {
            sessionId: active.sessionId,
            intentId: `graceful-shutdown:${active.runId}:${crypto.randomUUID()}`,
            targetRunId: active.runId,
            sourceMessageId: active.userMessageId,
            role: active.role ?? "",
            reason: "graceful-shutdown",
            sourceDisposition: active.sourceDisposition,
            createdAt: this.nowIso(),
          };
          if (intent.role !== "") {
            const recoveryStore = this.requireCodexRecoveryFactStore();
            await this.storeCall("local-console-store-record-graceful-resume", () =>
              recoveryStore.recordCodexResumeIntent(intent));
            const releaseMessageForResume = this.options.store.releaseMessageForResume;
            if (releaseMessageForResume === undefined) {
              throw new Error("local console graceful resume persistence capability unavailable");
            }
            await this.storeCall("local-console-store-release-graceful-resume", () =>
              releaseMessageForResume.call(this.options.store, {
                userMessageId: active.userMessageId,
                sessionId: active.sessionId,
                sourceDisposition: active.sourceDisposition,
                targetRunId: active.runId,
                role: active.role ?? "",
                now: this.nowIso(),
              }));
            active.gracefulResumePrepared = true;
          }
        }
      } catch (error) {
        this.lastError = formatLocalError(error);
        log({
          event: "local-console-prepare-graceful-resume-failed",
          sessionId: active.sessionId,
          runId: active.runId,
          error: this.lastError,
        });
      }
      active.controller.abort("runtime-closing");
    }
    const processingDeadline = Date.now() + this.storeTimeoutMs;
    while (
      (
        this.processingSessions.size > 0
        || this.workerWakeTasks.size > 0
        || this.workerLaneTails.size > 0
      )
      && Date.now() < processingDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await this.options.store.close();
  }

  async createProject(input: { folderPath: string; worktreeMode: boolean }): Promise<LocalConsoleProjectSummary> {
    return await this.storeCall("local-console-store-create-project", () =>
      this.options.store.createProject({
        folderPath: input.folderPath,
        worktreeMode: input.worktreeMode,
        now: this.nowIso(),
      }),
    );
  }

  async updateProject(input: { projectId: string; worktreeMode: boolean }): Promise<LocalConsoleProjectSummary> {
    await this.assertProjectDirectoryAvailable(input.projectId);
    return await this.storeCall("local-console-store-update-project", () =>
      this.options.store.updateProject({
        projectId: input.projectId,
        worktreeMode: input.worktreeMode,
        now: this.nowIso(),
      }),
    );
  }

  async repairProjectFolder(input: { projectId: string; folderPath: string }): Promise<LocalConsoleProjectSummary> {
    if (this.options.store.repairProjectFolder === undefined) {
      throw new Error("local console project folder repair unavailable");
    }
    const folderPath = path.resolve(input.folderPath);
    if (!(await directoryAvailable(folderPath))) {
      throw new LocalConsoleProjectFolderError(
        "PROJECT_DIRECTORY_UNAVAILABLE",
        "所选文件夹不可访问，请重新选择",
      );
    }
    try {
      const repaired = await this.storeCall("local-console-store-repair-project-folder", () =>
        this.options.store.repairProjectFolder!({
          projectId: input.projectId,
          folderPath,
          now: this.nowIso(),
        }),
      );
      for (const session of repaired.sessions) {
        void this.processPending(session.sessionId);
      }
      return this.withDirectoryAvailability(repaired, true);
    } catch (error) {
      const message = formatLocalError(error);
      if (message.includes("PROJECT_FOLDER_ALREADY_BOUND")) {
        throw new LocalConsoleProjectFolderError(
          "PROJECT_FOLDER_ALREADY_BOUND",
          "该文件夹已绑定其他项目，不能合并项目记录；请转到已有项目或重新选择",
        );
      }
      if (message.includes("LOCAL_PROJECT_NOT_FOUND")) {
        throw new LocalConsoleProjectFolderError("LOCAL_PROJECT_NOT_FOUND", "项目不存在或已移除");
      }
      throw error;
    }
  }

  async renameProject(input: { projectId: string; title: string }): Promise<LocalConsoleProjectSummary> {
    if (this.options.store.renameProject === undefined) {
      throw new Error("local console project rename unavailable");
    }
    return await this.storeCall("local-console-store-rename-project", () =>
      this.options.store.renameProject!({
        projectId: input.projectId,
        title: input.title,
        now: this.nowIso(),
      }),
    );
  }

  async removeProject(input: { projectId: string; force: boolean }): Promise<LocalConsoleProjectRemovalResult> {
    if (this.options.store.removeProject === undefined) {
      throw new Error("local console project removal unavailable");
    }
    const project = (await this.storeCall("local-console-store-list-projects", () => this.options.store.listProjects()))
      .find((candidate) => candidate.projectId === input.projectId);
    if (project === undefined) {
      throw new Error(`local console project not found: ${input.projectId}`);
    }
    if (project.runningCount > 0 && !input.force) {
      throw new LocalConsoleProjectRunningError();
    }

    const allSessions = await this.storeCall(
      "local-console-store-list-project-removal-sessions",
      () => this.options.store.listSessions(),
    );
    const removalRoots = project.sessions.map((session) => session.sessionId);
    const removalSessionIds = new Set(removalRoots);
    let changed = true;
    while (changed) {
      changed = false;
      for (const session of allSessions) {
        if (
          session.analysisParentSessionId !== null
          && session.analysisParentSessionId !== undefined
          && removalSessionIds.has(session.analysisParentSessionId)
          && !removalSessionIds.has(session.sessionId)
        ) {
          removalSessionIds.add(session.sessionId);
          changed = true;
        }
      }
    }
    const sessionIds = [...removalSessionIds];
    for (const sessionId of sessionIds) {
      this.inactiveSessions.add(sessionId);
      if (input.force) {
        for (const active of this.activeRunsForSession(sessionId)) {
          active.controller.abort("project-removed");
        }
      }
    }
    try {
      return await this.storeCall("local-console-store-remove-project", () =>
        this.options.store.removeProject!({
          projectId: input.projectId,
          force: input.force,
          now: this.nowIso(),
        }),
      );
    } catch (error) {
      for (const sessionId of sessionIds) {
        this.inactiveSessions.delete(sessionId);
      }
      if (error instanceof Error && error.message.includes("PROJECT_HAS_RUNNING_AGENTS")) {
        throw new LocalConsoleProjectRunningError();
      }
      throw error;
    }
  }

  async reorderProjects(projectIds: string[]): Promise<LocalConsoleProjectSummary[]> {
    return await this.storeCall("local-console-store-reorder-projects", () =>
      this.options.store.reorderProjects(projectIds),
    );
  }

  async createSession(
    title?: string,
    projectId?: string,
    agentTeam?: { ownership: "system" | "user"; id: string },
    initialMessage?: string,
    workspaceMode?: LocalConsoleWorkspaceMode,
    attachmentIds: string[] = [],
    metadata: {
      originSessionId?: string | null;
      analysisParentSessionId?: string | null;
      entryTemplate?: LocalConsoleEntryTemplate | null;
      writePolicy?: LocalConsoleWritePolicy;
      textFragments?: LocalConsoleTextFragment[];
      attachmentDraftKey?: string;
    } = {},
  ): Promise<LocalConsoleSessionSummary> {
    const sessionId = `local:${this.now().toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
    const resolvedProjectId = projectId ?? (await this.defaultProjectId());
    const normalizedInitialMessage = initialMessage?.trim();
    if (initialMessage !== undefined && normalizedInitialMessage === "" && attachmentIds.length === 0) {
      throw new Error("Message body must not be empty");
    }
    if (new Set(attachmentIds).size !== attachmentIds.length) {
      throw new Error("Attachment ids must be unique");
    }
    assertTextFragments(metadata.textFragments ?? []);
    const persistedInitialMessage = normalizedInitialMessage === undefined
      ? undefined
      : serializeTextFragmentReferences(normalizedInitialMessage, metadata.textFragments ?? []);
    if (persistedInitialMessage !== undefined) {
      await this.resolveReferenceContext(persistedInitialMessage);
    }
    await this.assertProjectDirectoryAvailable(resolvedProjectId);
    const project = await this.storedProject(resolvedProjectId);
    if (project === undefined) {
      throw new Error(`local console project not found: ${resolvedProjectId}`);
    }
    if (workspaceMode === "worktree") {
      const facts = await readCachedLocalWorkspaceFacts({
        folderPath: project.folderPath,
        gitTimeoutMs: this.options.workspaceGitTimeoutMs,
      });
      if (!facts.isGitRepository) {
        throw new Error("not-git-repository");
      }
    }
    let baselineCommit: string | null | undefined;
    if (normalizedInitialMessage !== undefined || attachmentIds.length > 0) {
      try {
        baselineCommit = await readLocalConversationBaselineCommit({
          folderPath: project.folderPath,
          gitTimeoutMs: this.options.workspaceGitTimeoutMs,
        });
      } catch (error) {
        baselineCommit = null;
        log({
          event: "local-console-conversation-baseline-unavailable",
          projectId: resolvedProjectId,
          error: formatLocalError(error),
        });
      }
    }
    const agentTeamSnapshot = agentTeam === undefined || this.options.loadAgentTeamSnapshot === undefined
      ? undefined
      : await this.options.loadAgentTeamSnapshot(agentTeam);
    let routeAgentNames = agentTeamSnapshot?.members.map((member) => member.name) ?? [];
    if (routeAgentNames.length === 0) {
      try {
        routeAgentNames = (await this.options.listAgentFiles(sessionId)).map((agent) => agent.name);
      } catch {
        // Legacy/custom stores without an available team keep the fail-safe primary dispatch.
      }
    }
    const initialDispatch = normalizedInitialMessage === undefined && attachmentIds.length === 0
      ? undefined
      : routeAgentNames[0] === undefined
        ? undefined
        : resolveLocalUserMessageDispatch({
            body: normalizedInitialMessage ?? "",
            availableAgentNames: routeAgentNames,
            primaryAgent: routeAgentNames[0],
          });
    const firstAttachment = attachmentIds.length === 0
      ? undefined
      : (await this.options.attachmentManager?.listDraft("draft:new"))
        ?.find((attachment) => attachment.attachmentId === attachmentIds[0]);
    const session = await this.storeCall("local-console-store-create-session", () =>
      this.options.store.createSession({
        sessionId,
        projectId: resolvedProjectId,
        title: normalizedInitialMessage
          ? deriveSessionTitle(normalizedInitialMessage)
          : firstAttachment === undefined
            ? normalizeTitle(title)
            : deriveSessionTitle(firstAttachment.displayName),
        agentTeamOwnership: agentTeam?.ownership,
        agentTeamId: agentTeam?.id,
        agentTeamSnapshot,
        workspaceMode,
        initialMessage: persistedInitialMessage,
        initialDispatch,
        initialAttachmentIds: attachmentIds,
        attachmentDraftKey: metadata.attachmentDraftKey ?? "draft:new",
        baselineCommit,
        originSessionId: metadata.originSessionId,
        analysisParentSessionId: metadata.analysisParentSessionId,
        entryTemplate: metadata.entryTemplate,
        writePolicy: metadata.writePolicy,
        initialTextFragments: [],
        now: this.nowIso(),
      }),
    );
    this.conversationBaselineCommits.set(sessionId, baselineCommit ?? null);
    if (normalizedInitialMessage !== undefined || attachmentIds.length > 0) {
      void this.processPending(sessionId);
    }
    return session;
  }

  async moveEmptySessionToProject(input: {
    sessionId: string;
    projectId: string;
  }): Promise<LocalConsoleSessionSummary> {
    return await this.storeCall("local-console-store-move-empty-session", () =>
      this.options.store.moveEmptySessionToProject({
        ...input,
        now: this.nowIso(),
      }),
    );
  }

  async switchSessionWorkspace(input: {
    sessionId: string;
    workspaceMode: LocalConsoleWorkspaceMode;
  }): Promise<LocalConsoleSessionSummary> {
    const messages = await this.storeCall("local-console-store-list-session-messages", () =>
      this.options.store.listMessages(input.sessionId),
    );
    if (messages.length > 0) {
      throw new LocalConsoleSessionWorkspaceLockedError();
    }
    const source = await this.storeCall("local-console-store-session-workspace", () =>
      this.options.store.getSessionWorkspace(input.sessionId),
    );
    if (input.workspaceMode === "worktree") {
      const facts = await readCachedLocalWorkspaceFacts({
        folderPath: source.folderPath,
        gitTimeoutMs: this.options.workspaceGitTimeoutMs,
      });
      if (!facts.isGitRepository) {
        throw new Error("not-git-repository");
      }
    }
    let session: LocalConsoleSessionSummary;
    try {
      session = await this.storeCall("local-console-store-switch-session-workspace", () =>
        this.options.store.switchSessionWorkspace({
          sessionId: input.sessionId,
          workspaceMode: input.workspaceMode,
          now: this.nowIso(),
        }),
      );
    } catch (error) {
      if (formatLocalError(error) === "SESSION_WORKSPACE_LOCKED") {
        throw new LocalConsoleSessionWorkspaceLockedError();
      }
      throw error;
    }
    invalidateLocalWorkspaceFacts();
    return session;
  }

  async switchSessionTeam(input: {
    sessionId: string;
    agentTeamOwnership: LocalConsoleAgentTeamOwnership;
    agentTeamId: string;
  }): Promise<LocalConsoleSessionSummary> {
    const agentTeamSnapshot = this.options.loadAgentTeamSnapshot === undefined
      ? undefined
      : await this.options.loadAgentTeamSnapshot({
          ownership: input.agentTeamOwnership,
          id: input.agentTeamId,
        });
    return await this.storeCall("local-console-store-switch-session-team", () =>
      this.options.store.switchSessionTeam({ ...input, agentTeamSnapshot, now: this.nowIso() }),
    );
  }

  async archiveSession(sessionId: string): Promise<LocalConsoleSessionArchiveResult> {
    if (this.options.store.archiveSession === undefined) {
      throw new Error("local console session archive unavailable");
    }
    if (this.hasActiveRunForSession(sessionId)) {
      throw new LocalConsoleSessionRunningError();
    }
    this.inactiveSessions.add(sessionId);
    try {
      return await this.storeCall("local-console-store-archive-session", () =>
        this.options.store.archiveSession!({ sessionId, now: this.nowIso() }),
      );
    } catch (error) {
      this.inactiveSessions.delete(sessionId);
      throw error;
    }
  }

  async restoreSession(sessionId: string): Promise<LocalConsoleSessionSummary> {
    if (this.options.store.restoreSession === undefined) {
      throw new Error("local console session restore unavailable");
    }
    const session = await this.storeCall("local-console-store-restore-session", () =>
      this.options.store.restoreSession!({ sessionId, now: this.nowIso() }),
    );
    this.inactiveSessions.delete(sessionId);
    void this.processPending(sessionId);
    return session;
  }

  async searchSessions(input: {
    query: string;
    includeArchived: boolean;
  }): Promise<LocalConsoleSessionSearchResult[]> {
    if (this.options.store.searchSessions === undefined) {
      throw new Error("local console session search unavailable");
    }
    return await this.storeCall("local-console-store-search-sessions", () =>
      this.options.store.searchSessions!(input),
    );
  }

  async sessionReferenceText(input: {
    sessionId: string;
    scope: LocalConsoleSessionReferenceScope;
    runId?: string | null;
    messageId?: number | null;
  }): Promise<LocalConsoleSessionReferenceText> {
    const sessions = await this.storeCall(
      "local-console-store-list-sessions-for-reference",
      () => this.options.store.listSessions(),
    );
    const session = sessions.find((candidate) => candidate.sessionId === input.sessionId);
    if (session === undefined) {
      throw new Error(`local console session not found: ${input.sessionId}`);
    }
    const messages = input.scope === "message"
      ? await this.storeCall("local-console-store-list-reference-messages", () =>
          this.options.store.listMessages(input.sessionId))
      : [];
    const targetMessage = input.scope === "message"
      ? (input.messageId == null
          ? [...messages].reverse().find((message) => message.runId === (input.runId ?? null))
          : messages.find((message) => message.id === input.messageId))
      : undefined;
    if (input.scope === "message" && targetMessage === undefined) {
      throw new Error(`local console source message not found: ${input.sessionId}`);
    }
    const text = input.scope === "conversation"
      ? buildMoebiusReferenceText({
          scope: "conversation",
          sessionId: input.sessionId,
          title: session.title,
        })
      : buildMoebiusReferenceText({
          scope: "message",
          sessionId: input.sessionId,
          messageId: targetMessage!.id,
          role: targetMessage!.role ?? (targetMessage!.speaker === "user" ? "用户" : "协作者"),
          excerpt: plainTextExcerpt(targetMessage!.body),
        });
    return {
      sessionId: input.sessionId,
      runId: input.runId ?? null,
      scope: input.scope,
      fragment: {
        id: crypto.randomUUID(),
        label: "文本片段",
        text,
      },
    };
  }

  private async resolveReferenceContext(markdown: string): Promise<string | null> {
    const references = extractMoebiusReferences(markdown);
    if (references.length === 0) return null;
    const sessions = await this.storeCall(
      "local-console-store-list-reference-sessions",
      () => this.options.store.listSessions(),
    );
    const sessionById = new Map(sessions.map((session) => [session.sessionId, session]));
    const messageCache = new Map<string, LocalConsoleMessage[]>();
    const readMessages = async (sessionId: string): Promise<LocalConsoleMessage[]> => {
      const cached = messageCache.get(sessionId);
      if (cached !== undefined) return cached;
      const messages = await this.storeCall(
        "local-console-store-list-reference-context",
        () => this.options.store.listMessages(sessionId),
      );
      messageCache.set(sessionId, messages);
      return messages;
    };
    const sections: string[] = [];
    const seen = new Set<string>();
    for (const reference of references) {
      const key = reference.scope === "conversation"
        ? `conversation:${reference.sessionId}`
        : `message:${reference.sessionId}:${String(reference.messageId)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const session = sessionById.get(reference.sessionId);
      if (session === undefined) {
        throw new Error(`来源不可用：${reference.sessionId}`);
      }
      const messages = await readMessages(reference.sessionId);
      const selectedMessages = reference.scope === "conversation"
        ? messages.filter((message) =>
            message.status !== "pending"
            && message.sourceKind !== "pending-removed"
            && !isWorkerRunPlaceholder(message))
        : messages.filter((message) =>
            message.status !== "pending"
            && message.sourceKind !== "pending-removed"
            && !isWorkerRunPlaceholder(message)
            && (
              message.id === reference.messageId
              || (message.runId !== null
                && messages.some((candidate) =>
                  candidate.id === reference.messageId
                  && candidate.status !== "pending"
                  && candidate.sourceKind !== "pending-removed"
                  && candidate.runId === message.runId))
            ));
      if (reference.scope === "message" && !selectedMessages.some((message) => message.id === reference.messageId)) {
        throw new Error(`来源不可用：${session.title} 中的消息 ${String(reference.messageId)}`);
      }
      const runIds = [...new Set(selectedMessages
        .map((message) => message.runId)
        .filter((runId): runId is string => runId !== null))];
      const runOutputs = await Promise.all(runIds.map(async (runId) => {
        const output = await this.runOutput(reference.sessionId, runId);
        return [
          `#### 运行 ${runId}${output.role === null ? "" : ` · ${output.role}`}`,
          output.stdout === null ? "" : formatReferenceContentSegments("stdout", output.stdout),
          output.stderr === null ? "" : formatReferenceContentSegments("stderr", output.stderr),
          output.stdout === null && output.stderr === null && output.fallback !== null
            ? formatReferenceContentSegments("可用输出", output.fallback)
            : "",
        ].filter(Boolean).join("\n");
      }));
      sections.push([
        `### ${reference.scope === "conversation" ? "对话" : "消息"}来源：${session.title}`,
        ...selectedMessages.map((message) => [
          `- message=${String(message.id)} speaker=${message.speaker}`
            + `${message.role === null ? "" : ` role=${message.role}`}`
            + `${message.runId === null ? "" : ` run=${message.runId}`}`
            + ` status=${message.status}`,
          formatReferenceContentSegments("消息正文", message.body),
          (message.attachments?.length ?? 0) === 0
            ? ""
            : `附件：${message.attachments!.map((attachment) =>
                `${attachment.displayName} (${attachment.mediaType}, ${String(attachment.byteSize)} bytes)`).join("；")}`,
          message.runTiming == null
            ? ""
            : `运行时序：${JSON.stringify(message.runTiming)}`,
          message.error === null ? "" : `错误：${message.error}`,
        ].filter(Boolean).join("\n")),
        ...runOutputs,
      ].join("\n"));
    }
    return sections.length === 0
      ? null
      : `\n\n以下内容由 Moebius 根据消息中的公开 moebius-ref: 以只读方式提供；它不授予来源项目文件或其他对象的访问权限：\n\n${sections.join("\n\n")}`;
  }

  async createChildSession(input: {
    parentSessionId: string;
    childSessionId: string;
    projectId: string;
    title: string;
    relation?: string;
    hiddenKey: string;
    initialBody: string;
    initialRole?: string | null;
  }): Promise<LocalConsoleSessionSummary> {
    await this.assertProjectDirectoryAvailable(input.projectId);
    try {
      return await this.storeCall("local-console-store-create-child-session", () =>
        this.sessionFactStore().createChildSession({
          parentSessionId: input.parentSessionId,
          childSessionId: input.childSessionId,
          projectId: input.projectId,
          title: input.title,
          relation: input.relation ?? "task",
          hiddenKey: input.hiddenKey,
          initialBody: input.initialBody,
          initialRole: input.initialRole ?? null,
          now: this.nowIso(),
        }),
      );
    } catch (error) {
      const message = formatLocalError(error);
      this.lastError = message;
      await this.recordVisibleChildSessionFailureBestEffort(input.parentSessionId, message);
      throw error;
    }
  }

  getSessionFactLogPath(sessionId: string): string {
    const store = this.options.store as LocalConsoleStore
      & Partial<Pick<SessionFactWritingStore, "getSessionFactLogPath">>;
    const getSessionFactLogPath = store.getSessionFactLogPath;
    if (getSessionFactLogPath === undefined) {
      throw new Error("local console store does not provide the session fact log path");
    }
    return getSessionFactLogPath.call(store, sessionId);
  }

  async submitUserMessage(
    body: string,
    sessionId = this.sessionId,
    attachmentIds: string[] = [],
    resumeRunId?: string,
    textFragments: LocalConsoleTextFragment[] = [],
  ): Promise<LocalConsoleMessage> {
    const trimmed = body.trim();
    if (trimmed === "" && attachmentIds.length === 0) {
      throw new Error("Message body must not be empty");
    }
    if (new Set(attachmentIds).size !== attachmentIds.length) {
      throw new Error("Attachment ids must be unique");
    }
    assertTextFragments(textFragments);
    await this.assertSessionCanContinue(sessionId);
    const persistedBody = serializeTextFragmentReferences(trimmed, textFragments);

    const primaryRun = this.activeRunForLane(sessionId, "primary");
    if (
      primaryRun === undefined &&
      (await this.hasPersistedPrimaryRun(sessionId))
    ) {
      throw new LocalConsoleBusyError();
    }
    const session = await this.sessionSummary(sessionId);
    const dispatch = session.agentTeamPendingId !== null
      ? {
          lane: "awaiting-team" as const,
          role: null,
          reason: "no-valid-mention" as const,
        }
      : await this.resolveUserMessageDispatch(sessionId, trimmed);
    if (primaryRun === undefined) {
      await this.resolveReferenceContext(persistedBody);
    }

    const message = await this.storeCall("local-console-store-append-user", () =>
      this.options.store.appendUserMessage({
        sessionId,
        body: persistedBody,
        attachmentIds,
        attachmentDraftKey: `draft:${sessionId}`,
        textFragments: [],
        dispatch,
        now: this.nowIso(),
      }),
    );
    if (resumeRunId !== undefined) {
      const recoveryStore = this.codexRecoveryFactStore();
      const [executionLinks, codexLinks] = recoveryStore === null
        ? [[], []]
        : await Promise.all([
            readExecutionSessionLinks(recoveryStore.getSessionFactLogPath(sessionId), sessionId),
            readCodexThreadLinks(recoveryStore.getSessionFactLogPath(sessionId), sessionId),
          ]);
      const link = executionLinks.find((candidate) => candidate.runId === resumeRunId)
        ?? codexLinks.find((candidate) => candidate.runId === resumeRunId);
      if (link !== undefined) {
        await this.storeCall("local-console-store-record-edit-resume", () =>
          recoveryStore!.recordCodexResumeIntent({
            sessionId,
            intentId: crypto.randomUUID(),
            targetRunId: resumeRunId,
            sourceMessageId: message.id,
            role: link.role,
            reason: "edit-resend",
            createdAt: this.nowIso(),
        }));
      }
    }
    if (dispatch.lane === "worker") {
      this.schedulePendingWorkerWake(sessionId);
    }
    void this.processPending(sessionId);
    return message;
  }

  async retryPendingUserMessage(input: { sessionId: string; messageId: number }): Promise<void> {
    const markPendingReferenceError = this.options.store.markPendingReferenceError;
    if (markPendingReferenceError === undefined) {
      throw new Error("pending message retry unavailable");
    }
    await this.storeCall("local-console-store-clear-pending-reference-error", () =>
      markPendingReferenceError.call(this.options.store, {
        sessionId: input.sessionId,
        messageId: input.messageId,
        error: null,
        now: this.nowIso(),
    }));
    this.lastError = null;
    this.schedulePendingProcessing(input.sessionId);
  }

  async updatePendingUserMessage(input: {
    sessionId: string;
    messageId: number;
    body: string;
  }): Promise<LocalConsoleMessage> {
    const updatePendingUserMessage = this.options.store.updatePendingUserMessage;
    if (updatePendingUserMessage === undefined) {
      throw new Error("pending message editing unavailable");
    }
    const message = await this.storeCall("local-console-store-update-pending-user", () =>
      updatePendingUserMessage.call(this.options.store, {
        ...input,
        now: this.nowIso(),
    }));
    this.lastError = null;
    this.schedulePendingProcessing(input.sessionId);
    return message;
  }

  async removePendingUserMessage(input: { sessionId: string; messageId: number }): Promise<void> {
    const removePendingUserMessage = this.options.store.removePendingUserMessage;
    if (removePendingUserMessage === undefined) {
      throw new Error("pending message removal unavailable");
    }
    await this.storeCall("local-console-store-remove-pending-user", () =>
      removePendingUserMessage.call(this.options.store, {
        ...input,
        now: this.nowIso(),
    }));
    this.lastError = null;
    this.schedulePendingProcessing(input.sessionId);
  }

  async retryRun(input: {
    sessionId: string;
    runId: string;
    executionOverride?: {
      overrideId: string;
      profile: LocalConsoleExecutionProfile;
      scope: "single-run";
    };
  }): Promise<boolean> {
    if (
      input.executionOverride !== undefined
      && (
        input.executionOverride.scope !== "single-run"
        || input.executionOverride.overrideId.trim().length === 0
        || !isTrustedExecutionProfile(input.executionOverride.profile)
      )
    ) {
      return false;
    }
    if (input.executionOverride !== undefined) {
      const recoveryStore = this.codexRecoveryFactStore();
      if (recoveryStore !== null) {
        const recoveryFacts = await readLocalCodexRecoveryFacts(
          recoveryStore.getSessionFactLogPath(input.sessionId),
          input.sessionId,
        );
        if (recoveryFacts.intents.some((intent) =>
          intent.targetRunId === input.runId
          && intent.reason === "retry"
          && intent.executionOverride?.overrideId === input.executionOverride?.overrideId)) {
          return true;
        }
      }
    }
    const admission = await this.prepareRetryAdmission(input);
    if (admission === null) {
      return false;
    }
    const key = [
      admission.sessionId,
      admission.targetRunId,
      String(admission.source.id),
      admission.role ?? "",
      admission.executionOverride?.overrideId ?? "retry",
    ].join("\u0000");
    const pending = this.retryAdmissions.get(key);
    if (pending !== undefined) {
      return await pending;
    }
    const accepted = this.acceptRetryAdmission(admission);
    this.retryAdmissions.set(key, accepted);
    try {
      return await accepted;
    } finally {
      if (this.retryAdmissions.get(key) === accepted) {
        this.retryAdmissions.delete(key);
      }
    }
  }

  private async prepareRetryAdmission(input: {
    sessionId: string;
    runId: string;
    executionOverride?: {
      overrideId: string;
      profile: LocalConsoleExecutionProfile;
      scope: "single-run";
    };
  }): Promise<{
    sessionId: string;
    targetRunId: string;
    source: LocalConsoleMessage;
    role: string | null;
    recoveryStore: CodexRecoveryFactStore | null;
    recoveryFacts: Awaited<ReturnType<typeof readLocalCodexRecoveryFacts>>;
    executionOverride?: {
      overrideId: string;
      profile: LocalConsoleExecutionProfile;
      scope: "single-run";
    };
  } | null> {
    await this.assertSessionCanContinue(input.sessionId);
    const messages = await this.storeCall("local-console-store-list-retry-source", () =>
      this.options.store.listMessages(input.sessionId));
    const terminal = messages.find((message) =>
      message.runId === input.runId
      && (message.status === "stuck" || message.status === "failed" || message.status === "interrupted"));
    if (terminal === undefined) {
      return null;
    }
    if (input.executionOverride !== undefined) {
      const structuredTerminal = messages.find((message) =>
        message.runId === input.runId
        && message.speaker === "system"
        && message.terminal !== null
        && message.terminal !== undefined);
      if (
        structuredTerminal?.terminal === null
        || structuredTerminal?.terminal === undefined
        || (
          structuredTerminal.terminal.kind !== "interrupted"
          && structuredTerminal.terminal.kind !== "timeout"
          && structuredTerminal.terminal.kind !== "quota-exhausted"
          && structuredTerminal.terminal.kind !== "rate-limited"
          && structuredTerminal.terminal.kind !== "auth"
          && structuredTerminal.terminal.kind !== "crashed"
        )
      ) {
        return null;
      }
    }
    const recoveryStore = this.codexRecoveryFactStore();
    const [executionLinks, codexLinks, runContexts, recoveryFacts] = recoveryStore === null
      ? [[], [], [], {
          intents: [],
          consumedIntentIds: new Set<string>(),
          repairedIntentIds: new Set<string>(),
        }]
      : await Promise.all([
          readExecutionSessionLinks(recoveryStore.getSessionFactLogPath(input.sessionId), input.sessionId),
          readCodexThreadLinks(recoveryStore.getSessionFactLogPath(input.sessionId), input.sessionId),
          readRunExecutionContexts(recoveryStore.getSessionFactLogPath(input.sessionId), input.sessionId),
          readLocalCodexRecoveryFacts(recoveryStore.getSessionFactLogPath(input.sessionId), input.sessionId),
        ]);
    const link = executionLinks.find((candidate) => candidate.runId === input.runId)
      ?? codexLinks.find((candidate) => candidate.runId === input.runId);
    const runContext = runContexts.find((candidate) => candidate.runId === input.runId);
    const linkedRetryIntent = terminal.error === "retry-source-trigger-missing"
      && terminal.sourceKind === "local-retry-intent"
      && terminal.sourceId !== null
      ? recoveryFacts.intents.find((intent) =>
          intent.sessionId === input.sessionId
          && intent.intentId === terminal.sourceId
          && intent.reason === "retry"
          && !recoveryFacts.consumedIntentIds.has(intent.intentId))
      : undefined;
    if (
      terminal.error === "retry-source-trigger-missing"
      && linkedRetryIntent === undefined
    ) {
      return null;
    }
    const source = link === undefined
      ? linkedRetryIntent === undefined
        ? runContext === undefined
          ? messages.find((message) =>
              message.runId === input.runId
              && message.speaker !== "system"
              && (message.status === "stuck" || message.status === "failed" || message.status === "interrupted"))
          : messages.find((message) =>
              message.id === runContext.sourceMessageId
              && message.speaker !== "system")
        : messages.find((message) =>
            message.id === linkedRetryIntent.sourceMessageId
            && message.speaker !== "system")
      : messages.find((message) =>
          message.id === link.sourceMessageId
          && message.speaker !== "system");
    if (source === undefined) {
      return null;
    }
    const role = link?.role
      ?? linkedRetryIntent?.role
      ?? runContext?.role
      ?? source.dispatchRole
      ?? terminal.role
      ?? source.role;
    return {
      sessionId: input.sessionId,
      targetRunId: linkedRetryIntent?.targetRunId ?? input.runId,
      source,
      role,
      recoveryStore,
      recoveryFacts,
      ...(input.executionOverride === undefined
        ? {}
        : { executionOverride: input.executionOverride }),
    };
  }

  private async acceptRetryAdmission(input: {
    sessionId: string;
    targetRunId: string;
    source: LocalConsoleMessage;
    role: string | null;
    recoveryStore: CodexRecoveryFactStore | null;
    recoveryFacts: Awaited<ReturnType<typeof readLocalCodexRecoveryFacts>>;
    executionOverride?: {
      overrideId: string;
      profile: LocalConsoleExecutionProfile;
      scope: "single-run";
    };
  }): Promise<boolean> {
    const matchingIntent = input.recoveryFacts.intents.find((intent) =>
      intent.targetRunId === input.targetRunId
      && intent.sourceMessageId === input.source.id
      && intent.role === input.role
      && intent.reason === "retry"
      && intent.executionOverride?.overrideId === input.executionOverride?.overrideId);
    if (input.executionOverride !== undefined && matchingIntent !== undefined) {
      return true;
    }
    if (
      input.role !== null
      && this.activeRunForRole(input.sessionId, input.role) !== undefined
    ) {
      throw new LocalConsoleBusyError();
    }
    const existingIntent = matchingIntent !== undefined
      && !input.recoveryFacts.consumedIntentIds.has(matchingIntent.intentId)
      ? matchingIntent
      : undefined;
    if (input.recoveryStore !== null && input.role !== null && existingIntent === undefined) {
      await this.storeCall("local-console-store-record-user-retry", () =>
        input.recoveryStore!.recordCodexResumeIntent({
          sessionId: input.sessionId,
          intentId: crypto.randomUUID(),
          targetRunId: input.targetRunId,
          sourceMessageId: input.source.id,
          role: input.role!,
          reason: "retry",
          ...(input.executionOverride === undefined
            ? {}
            : { executionOverride: input.executionOverride }),
          createdAt: this.nowIso(),
        }));
    }
    await this.storeCall("local-console-store-release-user-retry", () =>
      this.options.store.releaseMessageForRetry({
        userMessageId: input.source.id,
        sessionId: input.sessionId,
        now: this.nowIso(),
      }));
    void this.processAfterCurrent(input.sessionId);
    return true;
  }

  async interruptRun(input: { sessionId: string; runId: string }): Promise<boolean> {
    const active = this.activeRuns.get(input.runId);
    if (active === undefined || active.sessionId !== input.sessionId) {
      return false;
    }
    active.controller.abort("user-interrupted");
    return true;
  }

  async markSessionResultRead(input: { sessionId: string; unreadSince: string }): Promise<boolean> {
    return await this.storeCall("local-console-store-mark-session-result-read", () =>
      this.options.store.markSessionResultRead({
        sessionId: input.sessionId,
        unreadSince: input.unreadSince,
        now: this.nowIso(),
      }),
    );
  }

  async updateSessionReadState(input: {
    sessionId: string;
    action: "mark-read-attention" | "mark-read-unread" | "mark-unread";
    expectedAttentionRevision: number;
    expectedReadStateRevision: number;
    expectedTitleRevision: number;
    isCurrent: boolean;
  }): Promise<LocalConsoleSessionSummary> {
    if (this.options.store.updateSessionReadState === undefined) {
      throw new Error("local console session read state unavailable");
    }
    return await this.storeCall("local-console-store-update-session-read-state", () =>
      this.options.store.updateSessionReadState!({ ...input, now: this.nowIso() }),
    );
  }

  async armSessionManualUnread(sessionId: string): Promise<LocalConsoleSessionSummary> {
    if (this.options.store.armSessionManualUnread === undefined) {
      throw new Error("local console manual unread unavailable");
    }
    return await this.storeCall("local-console-store-arm-session-manual-unread", () =>
      this.options.store.armSessionManualUnread!({ sessionId, now: this.nowIso() }),
    );
  }

  async markSessionViewed(sessionId: string): Promise<LocalConsoleSessionSummary> {
    if (this.options.store.markSessionViewed === undefined) {
      throw new Error("local console session view state unavailable");
    }
    return await this.storeCall("local-console-store-mark-session-viewed", () =>
      this.options.store.markSessionViewed!({ sessionId, now: this.nowIso() }),
    );
  }

  async setSessionPinned(input: {
    sessionId: string;
    pinned: boolean;
    expectedPinnedAt: string | null;
  }): Promise<LocalConsoleSessionSummary> {
    if (this.options.store.setSessionPinned === undefined) {
      throw new Error("local console session pin unavailable");
    }
    return await this.storeCall("local-console-store-set-session-pinned", () =>
      this.options.store.setSessionPinned!({ ...input, now: this.nowIso() }),
    );
  }

  async renameSession(input: {
    sessionId: string;
    title: string;
    expectedTitleRevision: number;
  }): Promise<LocalConsoleSessionSummary> {
    if (this.options.store.renameSession === undefined) {
      throw new Error("local console session rename unavailable");
    }
    return await this.storeCall("local-console-store-rename-session", () =>
      this.options.store.renameSession!({ ...input, now: this.nowIso() }),
    );
  }

  async snapshot(sessionId = this.sessionId): Promise<LocalConsoleSnapshot> {
    const messages = await this.storeCall("local-console-store-list", () => this.options.store.listMessages(sessionId));
    const primaryRunId = this.activeRunForLane(sessionId, "primary")?.runId ?? null;
    const activeRuns = await this.activeRunSnapshots(sessionId);
    return {
      sessionId,
      status: activeRuns.length > 0 || messages.some((message) => message.status === "running")
        ? "running"
        : messages.some((message) => message.status === "stuck")
          ? "stuck"
          : messages.some((message) => message.status === "failed")
            ? "failed"
            : "idle",
      messages: messages.filter(isVisibleTimelineMessage),
      sqlitePath: this.options.store.sqlitePath,
      lastError: this.lastError,
      pendingDispatchMessages: messages.filter(isPendingDispatchMessage).map(projectPendingDispatch),
      pendingPrimaryMessages: messages.filter(isPendingPrimaryMessage),
      activeRuns,
      activeRun: activeRuns.find((run) => run.runId === primaryRunId) ?? null,
    };
  }

  async state(selected: string | { sessionId?: string; projectId?: string } = this.sessionId): Promise<LocalConsoleStateSnapshot> {
    const selectedSessionId = typeof selected === "string" ? selected : (selected.sessionId ?? this.sessionId);
    const requestedProjectId = typeof selected === "string" ? undefined : selected.projectId;
    const storedProjects = await this.storeCall("local-console-store-list-projects", () => this.options.store.listProjects());
    const availableProjects = await Promise.all(storedProjects.map((project) => this.withDirectoryAvailability(project)));
    const projectsWithWorkspace = await Promise.all(
      availableProjects.map((project) => this.withSessionWorkspaceContext(project)),
    );
    const projects = projectsWithWorkspace.map((project) => this.withRuntimeActivity(project));
    await this.synchronizeNonContinuableRecords(projects);
    await this.stopUnsafeRunsWithUnavailableContext(projects);
    const sessions = projects.flatMap((project) => project.sessions);
    const firstRootSession = sessions.find((session) =>
      session.parentSessionId == null && session.analysisParentSessionId == null);
    const requestedProject = requestedProjectId === undefined ? undefined : projects.find((project) => project.projectId === requestedProjectId);
    const requestedSession = (requestedProject?.sessions ?? sessions).find((session) => session.sessionId === selectedSessionId);
    const selectedProject =
      requestedProject ??
      (requestedSession === undefined ? undefined : projects.find((project) => project.projectId === requestedSession.projectId)) ??
      (firstRootSession === undefined ? undefined : projects.find((project) => project.projectId === firstRootSession.projectId)) ??
      projects[0] ??
      buildFallbackProjectSummary(this.options.projectRoot);
    const storedSelectedSession =
      (requestedSession?.projectId === selectedProject.projectId ? requestedSession : undefined) ??
      selectedProject.sessions.find((session) =>
        session.parentSessionId == null && session.analysisParentSessionId == null) ??
      (requestedProject === undefined ? firstRootSession : undefined) ??
      null;
    const selectedSession = storedSelectedSession;
    const sessionId = selectedSession?.sessionId ?? selectedSessionId;
    const messages = selectedSession === null
      ? []
      : await this.storeCall("local-console-store-list", () => this.options.store.listMessages(sessionId));
    const childSessions = selectedSession === null
      ? []
      : await this.storeCall("local-console-store-list-child-sessions", () =>
          listLocalChildSessionSummaries({
            sqlitePath: this.options.store.sqlitePath,
            timeoutMs: this.storeTimeoutMs,
          }, selectedSession.sessionId));
    const memberIdentities = selectedSession === null
      ? []
      : projectLocalConsoleMemberIdentities(
          await this.storeCall("local-console-store-list-session-agent-team-snapshot", () =>
            this.options.store.listSessionAgentTeamSnapshot?.(sessionId) ?? Promise.resolve(null)),
        );
    const primaryRunId = this.activeRunForLane(sessionId, "primary")?.runId ?? null;
    const activeRuns = await this.activeRunSnapshots(sessionId);
    const activeRun = activeRuns.find((run) => run.runId === primaryRunId) ?? null;
    const workspaceDiff = selectedSession === null
      ? noSessionWorkspaceDiff()
      : await this.readConversationWorkspaceDiff(selectedSession.sessionId);
    return {
      projects,
      project: selectedProject,
      selectedProjectId: selectedProject.projectId,
      selectedSessionId: sessionId,
      selectedSession,
      messages: messages.filter(isVisibleTimelineMessage),
      pendingDispatchMessages: messages.filter(isPendingDispatchMessage).map(projectPendingDispatch),
      pendingPrimaryMessages: messages.filter(isPendingPrimaryMessage),
      childSessions,
      memberIdentities,
      activeRuns,
      activeRun,
      workspaceDiff,
      sqlitePath: this.options.store.sqlitePath,
      lastError: this.lastError,
    };
  }

  async sessionView(sessionId: string): Promise<LocalConsoleSessionView> {
    const sessions = await this.storeCall("local-console-store-list-sessions", () => this.options.store.listSessions());
    const session = sessions.find((candidate) => candidate.sessionId === sessionId);
    if (session === undefined) {
      throw new Error(`local console session not found: ${sessionId}`);
    }
    const messages = await this.storeCall("local-console-store-list", () => this.options.store.listMessages(sessionId));
    const primaryRunId = this.activeRunForLane(sessionId, "primary")?.runId ?? null;
    const activeRuns = await this.activeRunSnapshots(sessionId);
    const activeRun = activeRuns.find((run) => run.runId === primaryRunId) ?? null;
    const memberIdentities = projectLocalConsoleMemberIdentities(
      await this.storeCall("local-console-store-list-session-agent-team-snapshot", () =>
        this.options.store.listSessionAgentTeamSnapshot?.(sessionId) ?? Promise.resolve(null)),
    );
    return {
      session,
      messages: messages.filter(isVisibleTimelineMessage),
      pendingDispatchMessages: messages.filter(isPendingDispatchMessage).map(projectPendingDispatch),
      pendingPrimaryMessages: messages.filter(isPendingPrimaryMessage),
      memberIdentities,
      activeRuns,
      activeRun,
      workspaceDiff: await this.readConversationWorkspaceDiff(sessionId),
    };
  }

  async runOutput(sessionId: string, runId: string): Promise<LocalConsoleRunOutput> {
    const messages = await this.storeCall("local-console-store-list-run-output", () =>
      this.options.store.listMessages(sessionId),
    );
    const matching = messages.filter((message) => message.runId === runId);
    const active = this.activeRuns.get(runId);
    const matchingActive = active?.sessionId === sessionId ? active : undefined;
    const historicalWithRunDir = [...matching].reverse().find((message) => message.runDir !== null);
    const runDir = matchingActive?.runDir ?? historicalWithRunDir?.runDir ?? null;
    const [stdout, stderr] = runDir === null
      ? [null, null]
      : await Promise.all([
          readOptionalTextFile(path.join(runDir, "stdout.jsonl")),
          readOptionalTextFile(path.join(runDir, "stderr.log")),
        ]);
    const fallback = matching
      .map((message) => message.error ?? message.body)
      .filter((value) => value.trim() !== "")
      .join("\n\n") || null;
    if (matching.length === 0 && matchingActive === undefined) {
      throw new Error(`local console run not found: ${sessionId}/${runId}`);
    }
    return {
      sessionId,
      runId,
      role: matchingActive !== undefined
        ? matchingActive.role
        : [...matching].reverse().find((message) => message.role !== null)?.role ?? null,
      stdout,
      stderr,
      fallback,
    };
  }

  async workspaceDiffDetail(sessionId: string): Promise<LocalConsoleWorkspaceDiffDetail> {
    try {
      const context = await this.readConversationWorkspaceContext(sessionId);
      const diff = await readLocalConversationWorkspaceDiffDetail({
        workspacePath: context.workspacePath,
        baselineCommit: context.baselineCommit,
        gitTimeoutMs: this.options.workspaceGitTimeoutMs,
      });
      return { ...diff, workspaceMode: context.workspaceMode };
    } catch (error) {
      log({ event: "local-console-workspace-diff-detail-unavailable", sessionId, error: formatLocalError(error) });
      return {
        available: false,
        fileCount: null,
        files: [],
        reason: "workspace-unavailable",
        workspaceMode: await this.readWorkspaceModeBestEffort(sessionId),
      };
    }
  }

  async projectFiles(sessionId: string): Promise<LocalConsoleProjectFiles> {
    try {
      const context = await this.readConversationWorkspaceContext(sessionId);
      const [filePaths, diff] = await Promise.all([
        listLocalWorkspaceFiles(context.workspacePath),
        readLocalConversationWorkspaceDiffDetail({
          workspacePath: context.workspacePath,
          baselineCommit: context.baselineCommit,
          gitTimeoutMs: this.options.workspaceGitTimeoutMs,
        }),
      ]);
      const changes = new Map(diff.available ? diff.files.map((file) => [file.path, file]) : []);
      return {
        available: true,
        files: filePaths.map((filePath) => {
          const change = changes.get(filePath);
          return {
            path: filePath,
            additions: change?.additions ?? null,
            deletions: change?.deletions ?? null,
            changed: change !== undefined,
          };
        }),
        reason: null,
        workspaceMode: context.workspaceMode,
      };
    } catch (error) {
      log({ event: "local-console-project-files-unavailable", sessionId, error: formatLocalError(error) });
      return {
        available: false,
        files: [],
        reason: "workspace-unavailable",
        workspaceMode: await this.readWorkspaceModeBestEffort(sessionId),
      };
    }
  }

  async projectFile(sessionId: string, filePath: string): Promise<LocalConsoleFileContent> {
    try {
      const context = await this.readConversationWorkspaceContext(sessionId);
      const diff = await readLocalConversationWorkspaceDiffDetail({
        workspacePath: context.workspacePath,
        baselineCommit: context.baselineCommit,
        gitTimeoutMs: this.options.workspaceGitTimeoutMs,
      });
      if (diff.available && diff.files.some((file) => file.path === filePath)) {
        return await readLocalConversationDiffFile({
          workspacePath: context.workspacePath,
          baselineCommit: context.baselineCommit,
          filePath,
          gitTimeoutMs: this.options.workspaceGitTimeoutMs,
        });
      }
      return await readLocalWorkspaceTextFile({
        workspacePath: context.workspacePath,
        filePath,
      });
    } catch (error) {
      log({ event: "local-console-project-file-unavailable", sessionId, filePath, error: formatLocalError(error) });
      return {
        available: false,
        path: filePath,
        lines: [],
        reason: "workspace-unavailable",
      };
    }
  }

  async fileReference(
    sessionId: string,
    input: { filePath: string; line: number; column: number | null },
  ): Promise<import("./types.js").LocalConsoleFileReferenceContent> {
    try {
      return await readLocalFileReferenceWindow({
        filePath: input.filePath,
        line: input.line,
        column: input.column,
      });
    } catch (error) {
      log({
        event: "local-console-file-reference-unavailable",
        sessionId,
        filePath: input.filePath,
        line: input.line,
        error: formatLocalError(error),
      });
      return {
        available: false,
        path: input.filePath,
        lines: [],
        reason: "unavailable",
        targetLine: input.line,
        targetColumn: input.column,
      };
    }
  }

  async processOutput(
    sessionId: string,
    runId: string,
    cursor?: string,
  ): Promise<LocalConsoleProcessHistoryPage> {
    const messages = await this.storeCall("local-console-store-list-process-history", () =>
      this.options.store.listMessages(sessionId),
    );
    return await loadLocalProcessHistoryPage({
      sessionId,
      requestedRunId: runId,
      sessionFactLogPath: this.sessionFactStore().getSessionFactLogPath(sessionId),
      messages,
      activeRunIds: new Set(this.activeRunsForSession(sessionId).map((run) => run.runId)),
      trace: { dataRoot: this.options.dataRoot ?? this.options.projectRoot },
      ...(cursor === undefined ? {} : { cursor }),
    });
  }

  async processOutputAppend(
    sessionId: string,
    runId: string,
    appendCursor: string,
  ): Promise<LocalConsoleProcessAppendPage> {
    return await loadLocalProcessAppendPage({
      sessionId,
      requestedRunId: runId,
      sessionFactLogPath: this.sessionFactStore().getSessionFactLogPath(sessionId),
      activeRunIds: new Set(this.activeRunsForSession(sessionId).map((run) => run.runId)),
      appendCursor,
      trace: { dataRoot: this.options.dataRoot ?? this.options.projectRoot },
    });
  }

  async processDebugInvocation(
    sessionId: string,
    runId: string,
  ): Promise<LocalConsoleProcessDebugInvocation> {
    return await loadLocalProcessDebugInvocation({
      sessionId,
      runId,
      sessionFactLogPath: this.sessionFactStore().getSessionFactLogPath(sessionId),
      trace: { dataRoot: this.options.dataRoot ?? this.options.projectRoot },
    });
  }

  async childSessionSummaries(parentSessionId: string) {
    return await this.storeCall("local-console-store-list-child-sessions", () =>
      listLocalChildSessionSummaries({
        sqlitePath: this.options.store.sqlitePath,
        timeoutMs: this.storeTimeoutMs,
      }, parentSessionId));
  }

  async processPending(sessionId = this.sessionId): Promise<void> {
    if (this.closing || this.inactiveSessions.has(sessionId)) {
      return;
    }
    if (this.processingSessions.has(sessionId)) {
      this.pendingProcessSessions.add(sessionId);
      return;
    }

    this.processingSessions.add(sessionId);

    try {
      await this.repairStaleRunning(sessionId);
      await this.applyPendingSessionContextWhenIdle(sessionId);
      while (true) {
        if (this.closing || this.inactiveSessions.has(sessionId)) {
          return;
        }
        const workspaceSource = await this.continuableSessionWorkspace(sessionId);
        if (workspaceSource === null) {
          return;
        }
        await this.dispatchPendingWorkerMessages(sessionId, workspaceSource);
        if (await this.hasPersistedPrimaryRun(sessionId)) {
          return;
        }
        let pendingReferenceContext: string | null = null;
        let nextPendingUserMessage: LocalConsoleMessage | undefined;
        try {
          const pendingMessages = await this.storeCall(
            "local-console-store-list-pending-reference-source",
            () => this.options.store.listMessages(sessionId),
          );
          nextPendingUserMessage = pendingMessages
            .filter((message) => message.speaker === "user" && message.status === "pending")
            .sort((left, right) => left.id - right.id)[0];
          if (nextPendingUserMessage !== undefined) {
            pendingReferenceContext = await this.resolveReferenceContext(nextPendingUserMessage.body);
            if (nextPendingUserMessage.error !== null) {
              const markPendingReferenceError = this.options.store.markPendingReferenceError;
              if (markPendingReferenceError === undefined) {
                throw new Error("pending message reference error capability unavailable");
              }
              nextPendingUserMessage = await this.storeCall(
                "local-console-store-clear-pending-reference-error",
                () => markPendingReferenceError.call(this.options.store, {
                  sessionId,
                  messageId: nextPendingUserMessage!.id,
                  error: null,
                  now: this.nowIso(),
                }),
              );
            }
          }
        } catch (error) {
          this.lastError = formatLocalError(error);
          const markPendingReferenceError = this.options.store.markPendingReferenceError;
          if (nextPendingUserMessage !== undefined && markPendingReferenceError !== undefined) {
            try {
              await this.storeCall("local-console-store-mark-pending-reference-error", () =>
                markPendingReferenceError.call(this.options.store, {
                  sessionId,
                  messageId: nextPendingUserMessage!.id,
                  error: this.lastError,
                  now: this.nowIso(),
                }));
            } catch {
              // Preserve the source read failure as the useful user-facing error.
            }
          }
          return;
        }

        let activeMessage: LocalConsoleMessage | null = null;
        let activeRunId: string | null = null;
        let activeRunDir: string | null = null;

        try {
          const gracefulResumeTargets = await this.gracefulResumeTargetsForClaim(sessionId);
          const freshRunId = `local-${this.now().toISOString()}-${Math.random().toString(36).slice(2, 10)}`;
          activeMessage = await this.storeCall("local-console-store-claim", () =>
            this.options.store.claimNextPendingMessage({
              sessionId,
              runId: freshRunId,
              gracefulResumeTargets,
              now: this.nowIso(),
            }),
          );
          if (activeMessage === null) {
            return;
          }
          if (this.inactiveSessions.has(sessionId)) {
            return;
          }
          const claimedMessage = activeMessage;
          const nextRunId = gracefulResumeTargets.find((target) =>
            target.sourceMessageId === claimedMessage.id)?.targetRunId ?? freshRunId;
          activeRunId = nextRunId;
          if (this.inactiveSessions.has(sessionId)) {
            return;
          }

          const persistedSnapshot = await this.options.store.listSessionAgentTeamSnapshot?.(sessionId) ?? null;
          const agentFiles: LocalConsoleAgentFile[] = persistedSnapshot === null
            ? await this.options.listAgentFiles(sessionId)
            : persistedSnapshot.members.map((member) => ({
                name: member.name,
                agentMarkdown: member.agentMarkdown,
                executionProfile: member.executionProfile ?? null,
              }));
          if (this.inactiveSessions.has(sessionId)) {
            return;
          }
          const messages = await this.storeCall("local-console-store-list", () => this.options.store.listMessages(sessionId));
          const policySession = await this.sessionSummary(sessionId);
          const analysisGateEnabled =
            policySession.writePolicy === "confirm-current-plan-before-write";
          const timelineMessages = messages.filter(
            (message) => message.status !== "pending" && !isWorkerRunPlaceholder(message),
          );
          const timeline = buildLocalConsoleTimeline(
            timelineMessages,
            agentFiles.map((agent) => agent.name),
          );
          const routingTimeline = buildLocalConsoleRoutingTimeline(
            timelineMessages,
            claimedMessage.id,
            agentFiles.map((agent) => agent.name),
          );
          const explicitTrigger = resolveTrigger({
            // Runs can complete out of submission order when roles execute in parallel.
            // Keep the public context through the claimed source, but never route from
            // whichever later message currently sorts last in the shared timeline.
            timeline: routingTimeline,
            availableAgentNames: agentFiles.map((agent) => agent.name),
          });
          const primaryAgent = agentFiles[0]?.name ?? null;
          const trigger = claimedMessage.speaker === "user" && primaryAgent !== null
            ? { kind: "run-agent" as const, role: primaryAgent, reason: "mention" as const }
            : explicitTrigger.kind === "skip" && primaryAgent !== null
              ? claimedMessage.speaker === "agent" && claimedMessage.role !== primaryAgent
                ? { kind: "run-agent" as const, role: primaryAgent, reason: "mention" as const }
                : explicitTrigger
              : explicitTrigger;

          if (trigger.kind !== "run-agent") {
            if (claimedMessage.speaker === "agent") {
              const recoveryStore = this.codexRecoveryFactStore();
              const recoveryFacts = recoveryStore === null
                ? null
                : await readLocalCodexRecoveryFacts(
                    recoveryStore.getSessionFactLogPath(sessionId),
                    sessionId,
                  );
              const retryIntent = recoveryFacts === null
                ? undefined
                : [...recoveryFacts.intents].reverse().find((intent) =>
                    intent.reason === "retry"
                    && intent.sourceMessageId === claimedMessage.id
                    && !recoveryFacts.consumedIntentIds.has(intent.intentId));
              if (retryIntent !== undefined) {
                await this.storeCall("local-console-store-record-retry-trigger-missing", () =>
                  this.options.store.recordFailure({
                    userMessageId: claimedMessage.id,
                    sessionId,
                    error: "retry-source-trigger-missing",
                    runId: nextRunId,
                    runDir: null,
                    body: "这一步没跑起来。你可以直接告诉主理人下一步怎么处理。",
                    systemEventKind: "run-not-started",
                    sourceKind: "local-retry-intent",
                    sourceId: retryIntent.intentId,
                    now: this.nowIso(),
                  }));
                continue;
              }
              await this.storeCall("local-console-store-primary-closeout-complete", () =>
                this.options.store.recordMessageProcessed({
                  userMessageId: claimedMessage.id,
                  sessionId,
                  runId: nextRunId,
                  runDir: null,
                  now: this.nowIso(),
                }),
              );
              continue;
            }
            let route: Awaited<ReturnType<typeof maybeRouteLocalNoMentionMessage>>;
            try {
              route = await maybeRouteLocalNoMentionMessage({
                store: this.options.store,
                message: claimedMessage,
                sessionId,
                timeline,
                availableAgentNames: agentFiles.map((agent) => agent.name),
                runId: nextRunId,
                runDir: activeRunDir,
                agentsDir: path.join(this.options.projectRoot, "agents"),
                now: this.nowIso(),
                routeJudgment: this.options.routeJudgment,
                timeoutMs: this.routeTimeoutMs,
                runCodex: this.options.runCodex,
              });
            } catch (error) {
              await this.recordTerminalFailureBestEffort(
                claimedMessage,
                sessionId,
                nextRunId,
                activeRunDir,
                formatLocalError(error),
              );
              activeMessage = null;
              activeRunId = null;
              activeRunDir = null;
              throw error;
            }
            if (route.kind === "retry") {
              this.lastError = `local-route-retry:${route.reason}`;
              await this.recordTerminalFailureBestEffort(claimedMessage, sessionId, nextRunId, activeRunDir, this.lastError);
              return;
            }
            continue;
          }

          const selectedAgent = agentFiles.find((agent) => agent.name === trigger.role);
          if (selectedAgent === undefined) {
            await this.recordTerminalFailureBestEffort(claimedMessage, sessionId, nextRunId, null, `Agent not found: ${trigger.role}`);
            return;
          }

          if (
            claimedMessage.speaker === "agent"
            && primaryAgent !== null
            && trigger.role !== primaryAgent
          ) {
            await this.storeCall("local-console-store-detached-worker-source-processed", () =>
              this.options.store.recordMessageProcessed({
                userMessageId: claimedMessage.id,
                sessionId,
                runId: nextRunId,
                runDir: null,
                now: this.nowIso(),
              }),
            );
            activeMessage = null;
            this.scheduleWorkerRun({
              origin: "primary-redirect",
              sessionId,
              runId: nextRunId,
              sourceMessage: claimedMessage,
              role: trigger.role,
              selectedAgent,
              agentFiles,
              timeline,
              timelineMessages,
              workspaceSource,
            });
            activeRunId = null;
            continue;
          }

          const currentAgentMarkdown = selectedAgent.agentMarkdown
            ?? await fs.readFile(requireAgentFilePath(selectedAgent), "utf8");

          activeRunDir = this.options.makeRunDir(messages.length, this.now());
          const resolvedRunDir = path.resolve(activeRunDir);
          await this.storeCall("local-console-store-set-rundir", () =>
            this.options.store.setRunDir({
              id: claimedMessage.id,
              sessionId,
              runDir: resolvedRunDir,
              now: this.nowIso(),
            }),
          );

          const controller = new AbortController();
          const currentWorkspace = await this.resolveWorkspace(sessionId, workspaceSource, controller.signal);
          if (this.inactiveSessions.has(sessionId)) {
            return;
          }
          const agentContents = await Promise.all(agentFiles.map(async (agent) => ({
            name: agent.name,
            agentMarkdown: agent.name === selectedAgent.name
              ? currentAgentMarkdown
              : agent.agentMarkdown ?? await fs.readFile(requireAgentFilePath(agent), "utf8"),
            executionProfile: agent.executionProfile ?? null,
          })));
          const concurrentRecoveryWorkspace = this.concurrentAgentHandoffRecoveryWorkspace(sessionId);
          let currentContext = createRunExecutionContext({
            sessionId,
            runId: nextRunId,
            sourceMessageId: claimedMessage.id,
            role: trigger.role,
            profile: selectedAgent.executionProfile ?? null,
            workspace: concurrentRecoveryWorkspace ?? currentWorkspace,
            team: agentContents,
            referenceContext: pendingReferenceContext,
            recordedAt: this.nowIso(),
          });
          const recoveryStore = this.codexRecoveryFactStore();
          const [
            recoveryFacts,
            threadLinks,
            executionLinks,
            runContexts,
            canonicalLinks,
            observations,
            timelineCursors,
          ] = recoveryStore === null
            ? [
                { intents: [], consumedIntentIds: new Set<string>(), repairedIntentIds: new Set<string>() },
                [],
                [],
                [],
                [],
                [],
                [],
              ]
            : await Promise.all([
                readLocalCodexRecoveryFacts(recoveryStore.getSessionFactLogPath(sessionId), sessionId),
                readCodexThreadLinks(recoveryStore.getSessionFactLogPath(sessionId), sessionId),
                readExecutionSessionLinks(recoveryStore.getSessionFactLogPath(sessionId), sessionId),
                readRunExecutionContexts(recoveryStore.getSessionFactLogPath(sessionId), sessionId),
                readAgentSessionLinks(recoveryStore.getSessionFactLogPath(sessionId), sessionId),
                readProviderSessionObservations(recoveryStore.getSessionFactLogPath(sessionId), sessionId),
                readAgentTimelineCursors(recoveryStore.getSessionFactLogPath(sessionId), sessionId),
              ]);
          const executionOverrideIntent = [...recoveryFacts.intents].reverse().find((intent) =>
            intent.sourceMessageId === claimedMessage.id
            && intent.reason === "retry"
            && intent.executionOverride !== undefined
            && !recoveryFacts.consumedIntentIds.has(intent.intentId));
          if (executionOverrideIntent?.executionOverride !== undefined) {
            currentContext = createRunExecutionContext({
              sessionId,
              runId: nextRunId,
              sourceMessageId: claimedMessage.id,
              role: trigger.role,
              profile: executionOverrideIntent.executionOverride.profile,
              workspace: concurrentRecoveryWorkspace ?? currentWorkspace,
              team: agentContents,
              recordedAt: this.nowIso(),
              identitySalt: singleRunOverrideIdentitySalt(
                executionOverrideIntent.executionOverride,
              ),
            });
          }
          const persistedGracefulRecovery = exactGracefulRecoveryContext({
            sessionId,
            runId: nextRunId,
            sourceMessageId: claimedMessage.id,
            role: trigger.role,
            intents: recoveryFacts.intents,
            consumedIntentIds: recoveryFacts.consumedIntentIds,
            contexts: runContexts,
          });
          if (persistedGracefulRecovery !== null) {
            currentContext = createRunExecutionContext({
              sessionId,
              runId: nextRunId,
              sourceMessageId: claimedMessage.id,
              role: trigger.role,
              profile: persistedGracefulRecovery.context.profile,
              workspace: workspaceFromExecutionContext(persistedGracefulRecovery.context),
              team: agentContents,
              recordedAt: this.nowIso(),
              identitySalt: persistedGracefulRecovery.context.identitySalt,
            });
          }
          let recoveryPlan = planLocalExecutionRecovery({
            sourceMessageId: claimedMessage.id,
            role: trigger.role,
            currentContext,
            preferredIntentId: persistedGracefulRecovery?.intent.intentId,
            intents: recoveryFacts.intents,
            consumedIntentIds: recoveryFacts.consumedIntentIds,
            canonicalLinks,
            observations,
            executionLinks,
            legacyCodexLinks: threadLinks,
            contexts: runContexts,
          });
          if (recoveryPlan.kind === "resume" && recoveryPlan.context.engine === "codex") {
            const available = await (this.options.isCodexThreadAvailable
              ?? defaultCodexThreadAvailability)(recoveryPlan.externalSessionId);
            if (!available) {
              recoveryPlan = {
                kind: "unavailable",
                intent: recoveryPlan.intent,
                context: recoveryPlan.context,
                reason: "rollout-unavailable",
              };
            }
          }
          if (recoveryPlan.kind === "unavailable") {
            await this.settleUnavailableResume({
              sessionId,
              runId: nextRunId,
              sourceMessage: claimedMessage,
              intent: recoveryPlan.intent,
              role: trigger.role,
              engine: recoveryPlan.context.engine,
              reason: recoveryPlan.reason,
              runDir: resolvedRunDir,
            });
            return;
          }
          const continuingSameRun = recoveryPlan.kind === "resume"
            && recoveryPlan.intent?.reason === "graceful-shutdown"
            && recoveryPlan.intent.targetRunId === nextRunId;
          const executionContext = continuingSameRun
            ? recoveryPlan.context
            : {
                ...recoveryPlan.context,
                sessionId,
                runId: nextRunId,
                sourceMessageId: claimedMessage.id,
                referenceContext: currentContext.referenceContext ?? null,
                recordedAt: this.nowIso(),
              };
          const workspace = workspaceFromExecutionContext(executionContext);
          const executingAgent = executionContext.team.find((member) => member.name === trigger.role);
          if (executingAgent === undefined) {
            throw new Error(`Run execution context is missing Agent: ${trigger.role}`);
          }
          const agentManifest = parseAgentManifest(executingAgent.agentMarkdown);
          const fullPrompt = buildLocalAgentPrompt({
            role: trigger.role,
            agentMarkdown: agentManifest.body,
            timeline,
            primaryAgent: executionContext.team[0]?.name ?? trigger.role,
            availableAgentNames: executionContext.team.map((agent) => agent.name),
          });
          if (!continuingSameRun) {
            await this.recordRunExecutionContext(executionContext);
          }
          if (recoveryPlan.kind === "resume" && recoveryPlan.canonicalLinkMissing) {
            await this.recordAgentSessionLink({
              sessionId,
              agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
              role: trigger.role,
              engine: executionContext.engine,
              externalSessionId: recoveryPlan.externalSessionId,
              profileFingerprint: executionContext.profileFingerprint,
              contextFingerprint: executionContext.contextFingerprint,
              linkedAt: this.nowIso(),
            });
          }
          const cursor = latestAgentTimelineCursor(
            timelineCursors,
            executionContext.agentIdentityFingerprint,
          );
          const deltaTimeline = recoveryPlan.kind === "resume" && !continuingSameRun
            ? selectLocalTimelineDelta(timeline, trigger.role, cursor?.lastSeenIndex ?? -1)
            : timeline;
          const deltaIndexes = new Set(deltaTimeline.map((message) => message.index));
          const attachmentMessages = recoveryPlan.kind === "resume" && !continuingSameRun
            ? timelineMessages.filter((_message, index) => deltaIndexes.has(index))
            : timelineMessages;
          const preparedAttachments = this.options.attachmentManager === undefined
            ? { promptSuffix: "", imagePaths: [] as string[] }
            : await this.options.attachmentManager.prepareRunAttachments({
                messages: attachmentMessages,
                runDir: resolvedRunDir,
              });
          const continuingIntent = continuingSameRun && recoveryPlan.kind === "resume"
            ? recoveryPlan.intent
            : null;
          let prompt = continuingIntent !== null
            ? buildLocalResumePrompt({
                reason: continuingIntent.reason,
                ...(continuingIntent.reason === "edit-resend" ? { correctionBody: claimedMessage.body } : {}),
              })
            : recoveryPlan.kind === "resume"
              ? recoveryPlan.intent?.reason === "edit-resend"
                ? `${buildLocalResumePrompt({
                    reason: "edit-resend",
                    correctionBody: claimedMessage.body,
                  })}\n\n${buildLocalAgentDeltaPrompt({ role: trigger.role, timeline: deltaTimeline })}`
                : buildLocalAgentDeltaPrompt({ role: trigger.role, timeline: deltaTimeline })
              : fullPrompt;
          if (analysisGateEnabled && trigger.role === primaryAgent) {
            prompt += buildSessionAnalysisReadOnlyContract(policySession.proposalVersion ?? null);
          }
          prompt += executionContext.referenceContext ?? "";
          prompt += preparedAttachments.promptSuffix;

          if (recoveryPlan.intent !== null) {
            const consumedIntent = recoveryPlan.intent;
            const recoveryStore = this.requireCodexRecoveryFactStore();
            await this.storeCall("local-console-store-consume-resume", () =>
              recoveryStore.recordCodexResumeConsumed({
                sessionId,
                intentId: consumedIntent.intentId,
                resumedByRunId: nextRunId,
                mode: recoveryPlan.kind === "resume"
                  ? "resume"
                  : consumedIntent.executionOverride === undefined
                    ? "unavailable"
                    : "full-fallback",
                reason: recoveryPlan.reason,
                consumedAt: this.nowIso(),
              }));
          }
          const primaryStepId = `message:${String(claimedMessage.id)}`;
          const primaryLifecycle = await this.prepareRunLifecycle({
            sessionId,
            runId: nextRunId,
            stepId: primaryStepId,
            resumeExisting: continuingSameRun,
          });
          const primaryActiveRun: ActiveLocalRun = {
            sessionId,
            runId: nextRunId,
            userMessageId: claimedMessage.id,
            role: trigger.role,
            lane: "primary",
            sourceDisposition: "primary",
            runDir: resolvedRunDir,
            cwd: workspace.cwd,
            workspaceMode: workspace.mode,
            worktreeUnavailableReason: workspace.worktreeUnavailableReason,
            branchName: workspace.branchName,
            baseRef: workspace.baseRef,
            originalRepoRoot: workspace.originalRepoRoot,
            liveMarkdown: null,
            activity: null,
            activitySequence: 0,
            activityFactTail: Promise.resolve(),
            longRunReported: false,
            createdAt: primaryLifecycle.createdAt,
            startedAt: primaryLifecycle.startedAt,
            segmentStartedAt: null,
            accumulatedMs: primaryLifecycle.accumulatedMs,
            resuming: primaryLifecycle.resuming,
            stepId: primaryStepId,
            attempt: primaryLifecycle.attempt,
            engine: executionContext.engine,
            profile: executionContext.profile,
            processOutputAvailable: true,
            terminalRecorded: false,
            controller,
            threadId: null,
            gracefulResumePrepared: false,
          };
          this.activeRuns.set(nextRunId, primaryActiveRun);
          if (!primaryLifecycle.resuming) {
            await this.recordRunLifecycle(primaryActiveRun, "created", "created");
          }

          let progressFactTail = Promise.resolve();
          let observedExternalSessionId: string | null = null;
          let executionTraceExternalSessionId: string | null = null;
          await this.recordProviderInvocation({
            sessionId,
            runId: nextRunId,
            invocationId: `${nextRunId}:${resolvedRunDir}`,
            role: trigger.role,
            agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
            phase: "started",
            mode: recoveryPlan.kind === "resume" ? "resume" : "full",
            requestedExternalSessionId: recoveryPlan.kind === "resume"
              ? recoveryPlan.externalSessionId
              : null,
            observedExternalSessionId: null,
            outcome: "started",
            recordedAt: this.nowIso(),
          });
          let result = await (async () => {
            try {
              return await this.executionRunner({
                prompt,
                runDir: activeRunDir,
                cwd: workspace.cwd,
                profile: executionContext.profile,
                mode: recoveryPlan.kind === "resume"
                  ? { kind: "resume", externalSessionId: recoveryPlan.externalSessionId }
                  : { kind: "full" },
                signal: controller.signal,
                ...(this.codexIdleTimeoutMs === undefined ? {} : { idleTimeoutMs: this.codexIdleTimeoutMs }),
                ...(this.toolInFlightTimeoutMs === undefined
                  ? {}
                  : { toolTimeoutMs: this.toolInFlightTimeoutMs }),
                ...(preparedAttachments.imagePaths.length === 0 ? {} : { imagePaths: preparedAttachments.imagePaths }),
                workspaceAccess: analysisGateEnabled ? "read-only" : "read-write",
                onVisibleAgentMarkdown: (text) => {
                  const active = this.activeRuns.get(nextRunId);
                  if (active?.sessionId === sessionId) {
                    active.liveMarkdown = text;
                    this.updateAgentProgressActivity(nextRunId, text);
                    const recordedAt = this.nowIso();
                    progressFactTail = progressFactTail.then(() =>
                      this.storeCall("local-console-store-record-progress", () =>
                        this.sessionFactStore().recordProgressEvent({
                          sessionId,
                          runId: nextRunId,
                          role: trigger.role,
                          body: text,
                          now: recordedAt,
                        })));
                  }
                },
                onProcessStarted: () => this.markRunStarted(nextRunId),
                onStructuredActivity: (event) => this.updateStructuredRunActivity(nextRunId, event),
                onExecutionProgress: (event) => this.updateExecutionProgressActivity(nextRunId, event),
                onSessionStarted: async ({ engine, externalSessionId }) => {
                  observedExternalSessionId = externalSessionId;
                  const active = this.activeRuns.get(nextRunId);
                  if (active?.runId === nextRunId) {
                    active.threadId = externalSessionId;
                  }
                  if (continuingSameRun) {
                    return;
                  }
                  await this.recordProviderSessionObserved({
                    sessionId,
                    runId: nextRunId,
                    sourceMessageId: claimedMessage.id,
                    role: trigger.role,
                    engine,
                    externalSessionId,
                    observedAt: this.nowIso(),
                    agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
                    contextFingerprint: executionContext.contextFingerprint,
                  });
                  await this.recordAgentSessionLink({
                    sessionId,
                    agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
                    role: trigger.role,
                    engine,
                    externalSessionId,
                    profileFingerprint: executionContext.profileFingerprint,
                    contextFingerprint: executionContext.contextFingerprint,
                    linkedAt: this.nowIso(),
                  });
                },
                onExecutionTraceReady: async ({ engine, externalSessionId }) => {
                  if (observedExternalSessionId !== externalSessionId) {
                    throw new Error("execution-trace-ready-session-mismatch");
                  }
                  if (
                    executionTraceExternalSessionId !== null
                    && executionTraceExternalSessionId !== externalSessionId
                  ) {
                    throw new Error("execution-trace-ready-session-conflict");
                  }
                  executionTraceExternalSessionId = externalSessionId;
                  if (continuingSameRun) {
                    return;
                  }
                  await this.recordExecutionSessionLink({
                    sessionId,
                    runId: nextRunId,
                    sourceMessageId: claimedMessage.id,
                    role: trigger.role,
                    engine,
                    externalSessionId,
                    startedAt: this.nowIso(),
                    profileFingerprint: executionContext.profileFingerprint,
                    agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
                    contextFingerprint: executionContext.contextFingerprint,
                  });
                  if (engine === "codex") {
                    await this.recordCodexThreadLink({
                      sessionId,
                      runId: nextRunId,
                      sourceMessageId: claimedMessage.id,
                      role: trigger.role,
                      threadId: externalSessionId,
                      startedAt: this.nowIso(),
                      contextFingerprint: executionContext.profile === null
                        ? legacyCodexContextFingerprint(executionContext)
                        : executionContext.contextFingerprint,
                    });
                  }
                },
              });
            } finally {
              await progressFactTail;
            }
          })();

          if (
            result.ok
            && executionContext.engine === "kimi"
            && result.threadId !== null
            && !continuingSameRun
          ) {
            if (observedExternalSessionId === null) {
              observedExternalSessionId = result.threadId;
              await this.recordProviderSessionObserved({
                sessionId,
                runId: nextRunId,
                sourceMessageId: claimedMessage.id,
                role: trigger.role,
                engine: executionContext.engine,
                externalSessionId: result.threadId,
                observedAt: this.nowIso(),
                agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
                contextFingerprint: executionContext.contextFingerprint,
              });
              await this.recordAgentSessionLink({
                sessionId,
                agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
                role: trigger.role,
                engine: executionContext.engine,
                externalSessionId: result.threadId,
                profileFingerprint: executionContext.profileFingerprint,
                contextFingerprint: executionContext.contextFingerprint,
                linkedAt: this.nowIso(),
              });
            }
            if (executionTraceExternalSessionId === null) {
              executionTraceExternalSessionId = result.threadId;
              await this.recordExecutionSessionLink({
                sessionId,
                runId: nextRunId,
                sourceMessageId: claimedMessage.id,
                role: trigger.role,
                engine: executionContext.engine,
                externalSessionId: result.threadId,
                startedAt: this.nowIso(),
                profileFingerprint: executionContext.profileFingerprint,
                agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
                contextFingerprint: executionContext.contextFingerprint,
              });
            }
          }

          if (
            analysisGateEnabled
            && trigger.role === primaryAgent
            && result.ok
            && result.completionKind !== "terminal-tool-result"
          ) {
            const parsedControl = parseSessionAnalysisResponse(result.finalText);
            if (parsedControl.control?.action === "proposal") {
              await this.updateSessionAnalysisGate({
                sessionId,
                proposalVersion: parsedControl.control.version,
                writeLeaseVersion: null,
              });
              result = { ...result, finalText: parsedControl.visibleText };
            } else if (parsedControl.control?.action === "confirm") {
              const confirmedVersion = parsedControl.control.version;
              const externalSessionId = observedExternalSessionId ?? result.threadId;
              if (
                policySession.proposalVersion !== confirmedVersion
                || externalSessionId === null
              ) {
                result = {
                  ...result,
                  finalText: [
                    parsedControl.visibleText,
                    "这次确认没有与当前方案版本精确匹配，或当前 provider 会话无法安全继续；我保持只读，没有修改文件。请先重新确认当前完整方案。",
                  ].filter((part) => part.trim() !== "").join("\n\n"),
                };
              } else {
                await this.updateSessionAnalysisGate({
                  sessionId,
                  proposalVersion: confirmedVersion,
                  writeLeaseVersion: confirmedVersion,
                });
                try {
                  result = await this.executionRunner({
                    prompt: buildConfirmedPlanExecutionPrompt(confirmedVersion),
                    runDir: activeRunDir,
                    cwd: workspace.cwd,
                    profile: executionContext.profile,
                    mode: { kind: "resume", externalSessionId },
                    signal: controller.signal,
                    workspaceAccess: "read-write",
                    ...(this.codexIdleTimeoutMs === undefined ? {} : { idleTimeoutMs: this.codexIdleTimeoutMs }),
                    ...(this.toolInFlightTimeoutMs === undefined
                      ? {}
                      : { toolTimeoutMs: this.toolInFlightTimeoutMs }),
                    onVisibleAgentMarkdown: (text) => {
                      const active = this.activeRuns.get(nextRunId);
                      if (active?.sessionId === sessionId) {
                        active.liveMarkdown = text;
                        this.updateAgentProgressActivity(nextRunId, text);
                      }
                    },
                    onStructuredActivity: (event) => this.updateStructuredRunActivity(nextRunId, event),
                    onExecutionProgress: (event) => this.updateExecutionProgressActivity(nextRunId, event),
                    onSessionStarted: async ({ externalSessionId: resumedSessionId }) => {
                      if (resumedSessionId !== externalSessionId) {
                        throw new Error("analysis-write-lease-provider-session-mismatch");
                      }
                    },
                  });
                } finally {
                  await this.updateSessionAnalysisGate({
                    sessionId,
                    proposalVersion: confirmedVersion,
                    writeLeaseVersion: null,
                  });
                }
              }
            }
          }

          await this.recordProviderInvocation({
            sessionId,
            runId: nextRunId,
            invocationId: `${nextRunId}:${resolvedRunDir}`,
            role: trigger.role,
            agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
            phase: "terminal",
            mode: recoveryPlan.kind === "resume" ? "resume" : "full",
            requestedExternalSessionId: recoveryPlan.kind === "resume"
              ? recoveryPlan.externalSessionId
              : null,
            observedExternalSessionId,
            outcome: result.ok ? "succeeded" : "failed",
            recordedAt: this.nowIso(),
          });

          if (!result.ok) {
            const active = this.activeRuns.get(nextRunId);
            if (
              executionInterruptionCauseForResult(result) === "runtime-closing"
              && active?.gracefulResumePrepared
            ) {
              await this.pauseRunLifecycle(nextRunId);
            } else {
              await this.finishRunLifecycle(nextRunId, runTimingStatusForFailedResult(result));
            }
            await this.recordFailedCodexResult(claimedMessage, sessionId, nextRunId, result);
            return;
          }
          const terminalToolOnly = result.completionKind === "terminal-tool-result";
          await this.finishRunLifecycle(nextRunId, "completed");
          if (recoveryStore !== null && executionContext.engine === "codex") {
            await this.storeCall("local-console-store-record-codex-usage", () =>
              recoveryStore.recordCodexRunUsage({
                sessionId,
                runId: nextRunId,
                cachedInputTokens: result.cachedInputTokens,
                recordedAt: this.nowIso(),
              }));
          }

          const sourceDirectoryAvailable = await this.sessionProjectDirectoryAvailable(sessionId);

          const childSessionCard = sourceDirectoryAvailable && !terminalToolOnly && trigger.role === "ceo"
            ? await this.executeLocalCeoChildSessionOrchestrationIfNeeded({
              sessionId,
              runId: nextRunId,
              runDir: result.runDir,
              finalText: result.finalText,
              availableAgentNames: agentFiles.map((agent) => agent.name),
            })
            : null;

          if (sourceDirectoryAvailable) {
            await this.recordWorkspaceDiffIfNeeded(sessionId, nextRunId, resolvedRunDir, workspace, result.finalText, controller.signal);
          }

          try {
            if (terminalToolOnly) {
              await this.storeCall("local-console-store-record-tool-only-complete", () =>
                this.options.store.recordMessageProcessed({
                  userMessageId: claimedMessage.id,
                  sessionId,
                  runId: nextRunId,
                  runDir: result.runDir,
                  now: this.nowIso(),
                }),
              );
            } else {
              await this.storeCall("local-console-store-record-agent-response", () =>
                this.options.store.recordAgentResponse({
                  userMessageId: claimedMessage.id,
                  sessionId,
                  role: trigger.role,
                  body: result.finalText,
                  runId: nextRunId,
                  runDir: result.runDir,
                  now: this.nowIso(),
                }),
              );
            }
            await this.recordAgentTimelineCursor({
              sessionId,
              runId: nextRunId,
              role: trigger.role,
              agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
              lastSeenIndex: timeline.at(-1)?.index ?? -1,
              recordedAt: this.nowIso(),
            });
          } catch (error) {
            await this.recordTerminalFailureBestEffort(
              claimedMessage,
              sessionId,
              nextRunId,
              result.runDir,
              formatLocalError(error),
            );
            activeMessage = null;
            activeRunDir = null;
            throw error;
          }
          if (childSessionCard !== null) {
            try {
              await this.storeCall("local-console-store-child-session-card", () =>
                this.sessionFactStore().recordChildSessionCard({
                  parentSessionId: sessionId,
                  sourceId: childSessionCard.sourceId,
                  childSessionIds: childSessionCard.childSessionIds,
                  runId: nextRunId,
                  runDir: result.runDir,
                  now: this.nowIso(),
                }));
            } catch (error) {
              const reason = formatLocalError(error);
              this.lastError = reason;
              await this.recordVisibleChildSessionFailureBestEffort(sessionId, reason);
              throw error;
            }
          }
          this.lastError = null;
          if (!sourceDirectoryAvailable) {
            await this.storeCall("local-console-store-directory-unavailable", () =>
              this.options.store.recordSystemMessage({
                sessionId,
                body: "项目文件夹不可用；隔离工作区已完成当前步骤，修复项目文件夹后才能继续。",
                systemEventKind: "other",
                runId: nextRunId,
                runDir: result.runDir,
                error: "PROJECT_DIRECTORY_UNAVAILABLE",
                status: "failed",
                now: this.nowIso(),
              }),
            );
            return;
          }
        } catch (error) {
          this.lastError = formatLocalError(error);
          if (activeMessage !== null && activeRunId !== null) {
            await this.recordTerminalFailureBestEffort(activeMessage, sessionId, activeRunId, activeRunDir, this.lastError);
          }
          log({ event: "local-console-processing-failed", error: this.lastError });
          return;
        } finally {
          const completedWorkspace = activeRunId === null
            ? null
            : this.activeRuns.get(activeRunId)?.cwd ?? null;
          if (activeRunId !== null) {
            const unfinished = this.activeRuns.get(activeRunId);
            if (unfinished !== undefined && !unfinished.terminalRecorded) {
              try {
                if (unfinished.gracefulResumePrepared) {
                  await this.pauseRunLifecycle(activeRunId);
                } else {
                  await this.finishRunLifecycle(activeRunId, "failed");
                }
              } catch (error) {
                this.lastError = formatLocalError(error);
              }
            }
            this.activeRuns.delete(activeRunId);
          }
          await this.applyPendingSessionContextWhenIdle(sessionId);
          if (completedWorkspace !== null) {
            invalidateLocalWorkspaceFacts(completedWorkspace);
          }
        }
      }
    } catch (error) {
      this.lastError = formatLocalError(error);
      log({ event: "local-console-processing-failed", error: this.lastError });
    } finally {
      this.processingSessions.delete(sessionId);
      if (!this.closing && this.pendingProcessSessions.delete(sessionId)) {
        void this.processPending(sessionId);
      } else if (this.closing) {
        this.pendingProcessSessions.delete(sessionId);
      }
    }
  }

  async processAllPending(): Promise<void> {
    const sessions = await this.storeCall("local-console-store-list-sessions", () => this.options.store.listSessions());
    const sessionIds = sessions
      .filter(hasPendingStartupControlWork)
      .map((session) => session.sessionId);
    for (const sessionId of sessionIds) {
      await this.processPending(sessionId);
    }
  }

  private async processAfterCurrent(sessionId: string): Promise<void> {
    while (!this.closing && this.processingSessions.has(sessionId)) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (!this.closing) {
      await this.processPending(sessionId);
    }
  }

  private schedulePendingProcessing(sessionId: string): void {
    setTimeout(() => {
      if (!this.closing) void this.processPending(sessionId);
    }, 25);
  }

  private async sessionSummary(sessionId: string): Promise<LocalConsoleSessionSummary> {
    const sessions = await this.storeCall(
      "local-console-store-list-session-policy",
      () => this.options.store.listSessions(),
    );
    const session = sessions.find((candidate) => candidate.sessionId === sessionId);
    if (session === undefined) {
      throw new Error(`local console session not found: ${sessionId}`);
    }
    return session;
  }

  private async updateSessionAnalysisGate(input: {
    sessionId: string;
    proposalVersion: string | null;
    writeLeaseVersion: string | null;
  }): Promise<LocalConsoleSessionSummary> {
    if (this.options.store.updateSessionAnalysisGate === undefined) {
      throw new Error("local console analysis gate persistence unavailable");
    }
    return await this.storeCall("local-console-store-update-analysis-gate", () =>
      this.options.store.updateSessionAnalysisGate!({
        ...input,
        now: this.nowIso(),
      }),
    );
  }

  private async dispatchPendingWorkerMessages(
    sessionId: string,
    workspaceSource: LocalConsoleSessionWorkspaceSource,
  ): Promise<void> {
    const claimWorker = this.options.store.claimNextPendingWorkerMessage;
    if (claimWorker === undefined) {
      return;
    }
    const pendingMessages = await this.storeCall("local-console-store-list-worker-pending", () =>
      this.options.store.listMessages(sessionId));
    const roles = [...new Set(
      pendingMessages
        .filter((message) =>
          message.speaker === "user"
          && message.status === "pending"
          && message.dispatchLane === "worker"
          && message.dispatchRole !== null)
        .map((message) => message.dispatchRole!),
    )];
    if (roles.length === 0) {
      return;
    }

    const persistedSnapshot = await this.options.store.listSessionAgentTeamSnapshot?.(sessionId) ?? null;
    const agentFiles: LocalConsoleAgentFile[] = persistedSnapshot === null
      ? await this.options.listAgentFiles(sessionId)
      : persistedSnapshot.members.map((member) => ({
          name: member.name,
          agentMarkdown: member.agentMarkdown,
          executionProfile: member.executionProfile ?? null,
        }));

    for (const role of roles) {
      if (this.closing || this.inactiveSessions.has(sessionId)) {
        return;
      }
      const laneKey = workerLaneKey(sessionId, role);
      if (
        this.activeRunForRole(sessionId, role) !== undefined
        || this.workerLaneTails.has(laneKey)
      ) {
        continue;
      }
      const pendingForRole = pendingMessages.find((message) =>
        message.speaker === "user"
        && message.status === "pending"
        && message.dispatchLane === "worker"
        && message.dispatchRole === role);
      if (pendingForRole === undefined) {
        continue;
      }
      const runId = await this.gracefulResumeTargetForMessage(sessionId, pendingForRole.id)
        ?? `local-${this.now().toISOString()}-${Math.random().toString(36).slice(2, 10)}`;
      if (this.closing || this.inactiveSessions.has(sessionId)) {
        return;
      }
      const sourceMessage = await this.storeCall("local-console-store-claim-worker", () =>
        claimWorker.call(this.options.store, {
          sessionId,
          role,
          runId,
          now: this.nowIso(),
        }));
      if (sourceMessage === null) {
        continue;
      }
      if (await this.releaseClaimedUserDirectMessageWhenStopping(sourceMessage, sessionId)) {
        return;
      }
      const selectedAgent = agentFiles.find((agent) => agent.name === role);
      if (selectedAgent === undefined) {
        await this.recordTerminalFailureBestEffort(
          sourceMessage,
          sessionId,
          runId,
          null,
          `Agent not found: ${role}`,
        );
        continue;
      }
      const messages = await this.storeCall("local-console-store-list-worker-timeline", () =>
        this.options.store.listMessages(sessionId));
      const timelineMessages = messages.filter(
        (message) => message.status !== "pending" && !isWorkerRunPlaceholder(message),
      );
      const timeline = buildLocalConsoleTimeline(
        timelineMessages,
        agentFiles.map((agent) => agent.name),
      );
      if (await this.releaseClaimedUserDirectMessageWhenStopping(sourceMessage, sessionId)) {
        return;
      }
      this.scheduleWorkerRun({
        origin: "user-direct",
        sessionId,
        runId,
        sourceMessage,
        role,
        selectedAgent,
        agentFiles,
        timeline,
        timelineMessages,
        workspaceSource,
      });
    }
  }

  private schedulePendingWorkerWake(sessionId: string): void {
    const task = this.wakePendingWorkerMessages(sessionId)
      .finally(() => {
        this.workerWakeTasks.delete(task);
      });
    this.workerWakeTasks.add(task);
  }

  private async wakePendingWorkerMessages(sessionId: string): Promise<void> {
    if (this.closing || this.inactiveSessions.has(sessionId)) {
      return;
    }
    try {
      const workspaceSource = await this.continuableSessionWorkspace(sessionId);
      if (workspaceSource === null) {
        return;
      }
      await this.dispatchPendingWorkerMessages(sessionId, workspaceSource);
    } catch (error) {
      this.lastError = formatLocalError(error);
      log({
        event: "local-console-worker-dispatch-failed",
        sessionId,
        error: this.lastError,
      });
    }
  }

  private async releaseClaimedUserDirectMessageWhenStopping(
    sourceMessage: LocalConsoleMessage,
    sessionId: string,
  ): Promise<boolean> {
    if (!this.closing && !this.inactiveSessions.has(sessionId)) {
      return false;
    }
    await this.storeCall("local-console-store-release-stopped-worker-claim", () =>
      this.options.store.releaseMessageForRetry({
        userMessageId: sourceMessage.id,
        sessionId,
        now: this.nowIso(),
      }));
    return true;
  }

  private scheduleWorkerRun(input: {
    origin: "primary-redirect" | "user-direct";
    sessionId: string;
    runId: string;
      sourceMessage: LocalConsoleMessage;
    role: string;
    selectedAgent: LocalConsoleAgentFile;
    agentFiles: LocalConsoleAgentFile[];
    timeline: ReturnType<typeof buildLocalConsoleTimeline>;
    timelineMessages: LocalConsoleMessage[];
    workspaceSource: LocalConsoleSessionWorkspaceSource;
  }): void {
    const laneKey = workerLaneKey(input.sessionId, input.role);
    const active = this.activeRunForRole(input.sessionId, input.role);
    if (input.origin === "primary-redirect" && active?.lane === "worker") {
      active.controller.abort("primary-redirected-active-agent");
    }

    const previous = this.workerLaneTails.get(laneKey) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(() => this.runWorker(input))
      .catch((error: unknown) => {
        this.lastError = formatLocalError(error);
        log({
          event: "local-console-worker-run-failed",
          sessionId: input.sessionId,
          role: input.role,
          error: this.lastError,
        });
      })
      .finally(() => {
        if (this.workerLaneTails.get(laneKey) === task) {
          this.workerLaneTails.delete(laneKey);
        }
        void this.applyPendingSessionContextWhenIdle(input.sessionId).catch((error: unknown) => {
          if (!this.closing && !this.inactiveSessions.has(input.sessionId)) {
            this.lastError = formatLocalError(error);
            log({
              event: "local-console-apply-pending-context-failed",
              sessionId: input.sessionId,
              error: this.lastError,
            });
          }
        });
        void this.processPending(input.sessionId);
      });
    this.workerLaneTails.set(laneKey, task);
  }

  private async runWorker(input: {
    origin: "primary-redirect" | "user-direct";
    sessionId: string;
    runId: string;
    sourceMessage: LocalConsoleMessage;
    role: string;
    selectedAgent: LocalConsoleAgentFile;
    agentFiles: LocalConsoleAgentFile[];
    timeline: ReturnType<typeof buildLocalConsoleTimeline>;
    timelineMessages: LocalConsoleMessage[];
    workspaceSource: LocalConsoleSessionWorkspaceSource;
  }): Promise<void> {
    if (this.closing || this.inactiveSessions.has(input.sessionId)) {
      if (input.origin === "user-direct") {
        await this.releaseClaimedUserDirectMessageWhenStopping(input.sourceMessage, input.sessionId);
      }
      return;
    }

    const runId = input.runId;
    const workerPolicySession = await this.sessionSummary(input.sessionId);
    const currentAgentMarkdown = input.selectedAgent.agentMarkdown
      ?? await fs.readFile(requireAgentFilePath(input.selectedAgent), "utf8");

    const runDir = path.resolve(this.options.makeRunDir(input.timelineMessages.length, this.now()));
    if (input.origin === "user-direct") {
      await this.storeCall("local-console-store-set-worker-source-rundir", () =>
        this.options.store.setRunDir({
          id: input.sourceMessage.id,
          sessionId: input.sessionId,
          runDir,
          now: this.nowIso(),
        }));
    }
    const controller = new AbortController();
    const currentWorkspace = await this.resolveWorkspace(input.sessionId, input.workspaceSource, controller.signal);
    if (this.closing || this.inactiveSessions.has(input.sessionId)) {
      if (input.origin === "user-direct") {
        await this.releaseClaimedUserDirectMessageWhenStopping(input.sourceMessage, input.sessionId);
      }
      return;
    }
    const agentContents = await Promise.all(input.agentFiles.map(async (agent) => ({
      name: agent.name,
      agentMarkdown: agent.name === input.selectedAgent.name
        ? currentAgentMarkdown
        : agent.agentMarkdown ?? await fs.readFile(requireAgentFilePath(agent), "utf8"),
      executionProfile: agent.executionProfile ?? null,
    })));
    let currentContext = createRunExecutionContext({
      sessionId: input.sessionId,
      runId,
      sourceMessageId: input.sourceMessage.id,
      role: input.role,
      profile: input.selectedAgent.executionProfile ?? null,
      workspace: currentWorkspace,
      team: agentContents,
      recordedAt: this.nowIso(),
    });
    const recoveryStore = this.codexRecoveryFactStore();
    const [
      recoveryFacts,
      threadLinks,
      executionLinks,
      runContexts,
      canonicalLinks,
      observations,
      timelineCursors,
    ] = recoveryStore === null
      ? [
          { intents: [], consumedIntentIds: new Set<string>(), repairedIntentIds: new Set<string>() },
          [],
          [],
          [],
          [],
          [],
          [],
        ]
      : await Promise.all([
          readLocalCodexRecoveryFacts(
            recoveryStore.getSessionFactLogPath(input.sessionId),
            input.sessionId,
          ),
          readCodexThreadLinks(
            recoveryStore.getSessionFactLogPath(input.sessionId),
            input.sessionId,
          ),
          readExecutionSessionLinks(
            recoveryStore.getSessionFactLogPath(input.sessionId),
            input.sessionId,
          ),
          readRunExecutionContexts(
            recoveryStore.getSessionFactLogPath(input.sessionId),
            input.sessionId,
          ),
          readAgentSessionLinks(
            recoveryStore.getSessionFactLogPath(input.sessionId),
            input.sessionId,
          ),
          readProviderSessionObservations(
            recoveryStore.getSessionFactLogPath(input.sessionId),
            input.sessionId,
          ),
          readAgentTimelineCursors(
            recoveryStore.getSessionFactLogPath(input.sessionId),
            input.sessionId,
          ),
        ]);
    const persistedGracefulRecovery = exactGracefulRecoveryContext({
      sessionId: input.sessionId,
      runId,
      sourceMessageId: input.sourceMessage.id,
      role: input.role,
      intents: recoveryFacts.intents,
      consumedIntentIds: recoveryFacts.consumedIntentIds,
      contexts: runContexts,
    });
    if (persistedGracefulRecovery !== null) {
      currentContext = createRunExecutionContext({
        sessionId: input.sessionId,
        runId,
        sourceMessageId: input.sourceMessage.id,
        role: input.role,
        profile: input.selectedAgent.executionProfile ?? null,
        workspace: workspaceFromExecutionContext(persistedGracefulRecovery.context),
        team: agentContents,
        recordedAt: this.nowIso(),
      });
    }
    let recoveryPlan = planLocalExecutionRecovery({
      sourceMessageId: input.sourceMessage.id,
      role: input.role,
      currentContext,
      preferredIntentId: persistedGracefulRecovery?.intent.intentId,
      intents: recoveryFacts.intents,
      consumedIntentIds: recoveryFacts.consumedIntentIds,
      canonicalLinks,
      observations,
      executionLinks,
      legacyCodexLinks: threadLinks,
      contexts: runContexts,
    });
    if (recoveryPlan.kind === "resume" && recoveryPlan.context.engine === "codex") {
      const available = await (this.options.isCodexThreadAvailable
        ?? defaultCodexThreadAvailability)(recoveryPlan.externalSessionId);
      if (!available) {
        recoveryPlan = {
          kind: "unavailable",
          intent: recoveryPlan.intent,
          context: recoveryPlan.context,
          reason: "rollout-unavailable",
        };
      }
    }
    if (recoveryPlan.kind === "unavailable") {
      await this.settleUnavailableResume({
        sessionId: input.sessionId,
        runId,
        sourceMessage: input.sourceMessage,
        intent: recoveryPlan.intent,
        role: input.role,
        engine: recoveryPlan.context.engine,
        reason: recoveryPlan.reason,
        runDir,
      });
      return;
    }
    const continuingSameRun = recoveryPlan.kind === "resume"
      && recoveryPlan.intent?.reason === "graceful-shutdown"
      && recoveryPlan.intent.targetRunId === runId;
    const executionContext = continuingSameRun
      ? recoveryPlan.context
      : {
          ...recoveryPlan.context,
          sessionId: input.sessionId,
          runId,
          sourceMessageId: input.sourceMessage.id,
          recordedAt: this.nowIso(),
        };
    const workspace = workspaceFromExecutionContext(executionContext);
    const executingAgent = executionContext.team.find((member) => member.name === input.role);
    if (executingAgent === undefined) {
      throw new Error(`Run execution context is missing Agent: ${input.role}`);
    }
    const agentManifest = parseAgentManifest(executingAgent.agentMarkdown);
    const fullPrompt = buildLocalAgentPrompt({
      role: input.role,
      agentMarkdown: agentManifest.body,
      timeline: input.timeline,
      primaryAgent: executionContext.team[0]?.name ?? input.role,
      availableAgentNames: executionContext.team.map((agent) => agent.name),
    });
    if (!continuingSameRun) {
      await this.recordRunExecutionContext(executionContext);
    }
    if (recoveryPlan.kind === "resume" && recoveryPlan.canonicalLinkMissing) {
      await this.recordAgentSessionLink({
        sessionId: input.sessionId,
        agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
        role: input.role,
        engine: executionContext.engine,
        externalSessionId: recoveryPlan.externalSessionId,
        profileFingerprint: executionContext.profileFingerprint,
        contextFingerprint: executionContext.contextFingerprint,
        linkedAt: this.nowIso(),
      });
    }
    const cursor = latestAgentTimelineCursor(
      timelineCursors,
      executionContext.agentIdentityFingerprint,
    );
    const deltaTimeline = recoveryPlan.kind === "resume" && !continuingSameRun
      ? selectLocalTimelineDelta(input.timeline, input.role, cursor?.lastSeenIndex ?? -1)
      : input.timeline;
    const deltaIndexes = new Set(deltaTimeline.map((message) => message.index));
    const attachmentMessages = recoveryPlan.kind === "resume" && !continuingSameRun
      ? input.timelineMessages.filter((_message, index) => deltaIndexes.has(index))
      : input.timelineMessages;
    const preparedAttachments = this.options.attachmentManager === undefined
      ? { promptSuffix: "", imagePaths: [] as string[] }
      : await this.options.attachmentManager.prepareRunAttachments({
          messages: attachmentMessages,
          runDir,
        });
    const continuingIntent = continuingSameRun && recoveryPlan.kind === "resume"
      ? recoveryPlan.intent
      : null;
    let prompt = continuingIntent !== null
      ? buildLocalResumePrompt({ reason: continuingIntent.reason })
      : recoveryPlan.kind === "resume"
        ? recoveryPlan.intent?.reason === "edit-resend"
          ? `${buildLocalResumePrompt({
              reason: "edit-resend",
              correctionBody: input.sourceMessage.body,
            })}\n\n${buildLocalAgentDeltaPrompt({ role: input.role, timeline: deltaTimeline })}`
          : buildLocalAgentDeltaPrompt({ role: input.role, timeline: deltaTimeline })
        : fullPrompt;
    prompt += preparedAttachments.promptSuffix;
    if (recoveryPlan.intent !== null) {
      const requiredRecoveryStore = this.requireCodexRecoveryFactStore();
      await this.storeCall("local-console-store-consume-worker-resume", () =>
        requiredRecoveryStore.recordCodexResumeConsumed({
          sessionId: input.sessionId,
          intentId: recoveryPlan.intent!.intentId,
          resumedByRunId: runId,
          mode: recoveryPlan.kind === "resume" ? "resume" : "full-fallback",
          reason: recoveryPlan.reason,
          consumedAt: this.nowIso(),
        }));
    }
    if (input.origin === "primary-redirect") {
      const recordDetachedRunStarted = this.options.store.recordDetachedRunStarted;
      if (recordDetachedRunStarted === undefined) {
        throw new Error("local console detached run persistence capability unavailable");
      }
      await this.storeCall("local-console-store-record-worker-started", () =>
        recordDetachedRunStarted.call(this.options.store, {
          sessionId: input.sessionId,
          role: input.role,
          runId,
          runDir,
          now: this.nowIso(),
        }),
      );
    }
    const workerStepId = `message:${String(input.sourceMessage.id)}`;
    const workerLifecycle = await this.prepareRunLifecycle({
      sessionId: input.sessionId,
      runId,
      stepId: workerStepId,
      resumeExisting: continuingSameRun,
    });
    const workerActiveRun: ActiveLocalRun = {
      sessionId: input.sessionId,
      runId,
      userMessageId: input.sourceMessage.id,
      role: input.role,
      lane: "worker",
      sourceDisposition: input.origin === "user-direct" ? "user-direct" : "agent-handoff",
      runDir,
      cwd: workspace.cwd,
      workspaceMode: workspace.mode,
      worktreeUnavailableReason: workspace.worktreeUnavailableReason,
      branchName: workspace.branchName,
      baseRef: workspace.baseRef,
      originalRepoRoot: workspace.originalRepoRoot,
      liveMarkdown: null,
      activity: null,
      activitySequence: 0,
      activityFactTail: Promise.resolve(),
      longRunReported: false,
      createdAt: workerLifecycle.createdAt,
      startedAt: workerLifecycle.startedAt,
      segmentStartedAt: null,
      accumulatedMs: workerLifecycle.accumulatedMs,
      resuming: workerLifecycle.resuming,
      stepId: workerStepId,
      attempt: workerLifecycle.attempt,
      engine: executionContext.engine,
      profile: executionContext.profile,
      processOutputAvailable: true,
      terminalRecorded: false,
      controller,
      threadId: null,
      gracefulResumePrepared: false,
    };
    if (this.closing || this.inactiveSessions.has(input.sessionId)) {
      if (input.origin === "user-direct") {
        await this.releaseClaimedUserDirectMessageWhenStopping(input.sourceMessage, input.sessionId);
      }
      return;
    }
    this.activeRuns.set(runId, workerActiveRun);
    const releaseDirectWorkerBeforeProviderWhenStopping = async (): Promise<boolean> => {
      if (
        input.origin !== "user-direct"
        || (!this.closing && !this.inactiveSessions.has(input.sessionId))
      ) {
        return false;
      }
      await this.releaseClaimedUserDirectMessageWhenStopping(input.sourceMessage, input.sessionId);
      await this.finishRunLifecycle(runId, "interrupted");
      return true;
    };
    if (!workerLifecycle.resuming) {
      await this.recordRunLifecycle(workerActiveRun, "created", "created");
    }

    let progressFactTail = Promise.resolve();
    let observedExternalSessionId: string | null = null;
    let executionTraceExternalSessionId: string | null = null;
    try {
      if (await releaseDirectWorkerBeforeProviderWhenStopping()) {
        return;
      }
      await this.recordProviderInvocation({
        sessionId: input.sessionId,
        runId,
        invocationId: `${runId}:${runDir}`,
        role: input.role,
        agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
        phase: "started",
        mode: recoveryPlan.kind === "resume" ? "resume" : "full",
        requestedExternalSessionId: recoveryPlan.kind === "resume"
          ? recoveryPlan.externalSessionId
          : null,
        observedExternalSessionId: null,
        outcome: "started",
        recordedAt: this.nowIso(),
      });
      if (await releaseDirectWorkerBeforeProviderWhenStopping()) {
        return;
      }
      const result = await (async () => {
        try {
          return await this.executionRunner({
            prompt,
            runDir,
            cwd: workspace.cwd,
            profile: executionContext.profile,
            mode: recoveryPlan.kind === "resume"
              ? { kind: "resume", externalSessionId: recoveryPlan.externalSessionId }
              : { kind: "full" },
            signal: controller.signal,
            ...(this.codexIdleTimeoutMs === undefined ? {} : { idleTimeoutMs: this.codexIdleTimeoutMs }),
            ...(this.toolInFlightTimeoutMs === undefined
              ? {}
              : { toolTimeoutMs: this.toolInFlightTimeoutMs }),
            ...(preparedAttachments.imagePaths.length === 0 ? {} : { imagePaths: preparedAttachments.imagePaths }),
            workspaceAccess: workerPolicySession.writePolicy === "confirm-current-plan-before-write"
              ? "read-only"
              : "read-write",
            onVisibleAgentMarkdown: (text) => {
              const active = this.activeRuns.get(runId);
              if (active?.sessionId === input.sessionId) {
                active.liveMarkdown = text;
                this.updateAgentProgressActivity(runId, text);
                const recordedAt = this.nowIso();
                progressFactTail = progressFactTail.then(() =>
                  this.storeCall("local-console-store-record-worker-progress", () =>
                    this.sessionFactStore().recordProgressEvent({
                      sessionId: input.sessionId,
                      runId,
                      role: input.role,
                      body: text,
                      now: recordedAt,
                    })));
              }
            },
            onProcessStarted: () => this.markRunStarted(runId),
            onStructuredActivity: (event) => this.updateStructuredRunActivity(runId, event),
            onExecutionProgress: (event) => this.updateExecutionProgressActivity(runId, event),
            onSessionStarted: async ({ engine, externalSessionId }) => {
              observedExternalSessionId = externalSessionId;
              const active = this.activeRuns.get(runId);
              if (active?.sessionId === input.sessionId) {
                active.threadId = externalSessionId;
              }
              if (continuingSameRun) {
                return;
              }
              await this.recordProviderSessionObserved({
                sessionId: input.sessionId,
                runId,
                sourceMessageId: input.sourceMessage.id,
                role: input.role,
                engine,
                externalSessionId,
                observedAt: this.nowIso(),
                agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
                contextFingerprint: executionContext.contextFingerprint,
              });
              await this.recordAgentSessionLink({
                sessionId: input.sessionId,
                agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
                role: input.role,
                engine,
                externalSessionId,
                profileFingerprint: executionContext.profileFingerprint,
                contextFingerprint: executionContext.contextFingerprint,
                linkedAt: this.nowIso(),
              });
            },
            onExecutionTraceReady: async ({ engine, externalSessionId }) => {
              if (observedExternalSessionId !== externalSessionId) {
                throw new Error("execution-trace-ready-session-mismatch");
              }
              if (
                executionTraceExternalSessionId !== null
                && executionTraceExternalSessionId !== externalSessionId
              ) {
                throw new Error("execution-trace-ready-session-conflict");
              }
              executionTraceExternalSessionId = externalSessionId;
              if (continuingSameRun) {
                return;
              }
              await this.recordExecutionSessionLink({
                sessionId: input.sessionId,
                runId,
                sourceMessageId: input.sourceMessage.id,
                role: input.role,
                engine,
                externalSessionId,
                startedAt: this.nowIso(),
                profileFingerprint: executionContext.profileFingerprint,
                agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
                contextFingerprint: executionContext.contextFingerprint,
              });
              if (engine === "codex") {
                await this.recordCodexThreadLink({
                  sessionId: input.sessionId,
                  runId,
                  sourceMessageId: input.sourceMessage.id,
                  role: input.role,
                  threadId: externalSessionId,
                  startedAt: this.nowIso(),
                  contextFingerprint: executionContext.profile === null
                    ? legacyCodexContextFingerprint(executionContext)
                    : executionContext.contextFingerprint,
                });
              }
            },
          });
        } finally {
          await progressFactTail;
        }
      })();

      if (
        result.ok
        && executionContext.engine === "kimi"
        && result.threadId !== null
        && !continuingSameRun
      ) {
        if (observedExternalSessionId === null) {
          observedExternalSessionId = result.threadId;
          await this.recordProviderSessionObserved({
            sessionId: input.sessionId,
            runId,
            sourceMessageId: input.sourceMessage.id,
            role: input.role,
            engine: executionContext.engine,
            externalSessionId: result.threadId,
            observedAt: this.nowIso(),
            agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
            contextFingerprint: executionContext.contextFingerprint,
          });
          await this.recordAgentSessionLink({
            sessionId: input.sessionId,
            agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
            role: input.role,
            engine: executionContext.engine,
            externalSessionId: result.threadId,
            profileFingerprint: executionContext.profileFingerprint,
            contextFingerprint: executionContext.contextFingerprint,
            linkedAt: this.nowIso(),
          });
        }
        if (executionTraceExternalSessionId === null) {
          executionTraceExternalSessionId = result.threadId;
          await this.recordExecutionSessionLink({
            sessionId: input.sessionId,
            runId,
            sourceMessageId: input.sourceMessage.id,
            role: input.role,
            engine: executionContext.engine,
            externalSessionId: result.threadId,
            startedAt: this.nowIso(),
            profileFingerprint: executionContext.profileFingerprint,
            agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
            contextFingerprint: executionContext.contextFingerprint,
          });
        }
      }

      await this.recordProviderInvocation({
        sessionId: input.sessionId,
        runId,
        invocationId: `${runId}:${runDir}`,
        role: input.role,
        agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
        phase: "terminal",
        mode: recoveryPlan.kind === "resume" ? "resume" : "full",
        requestedExternalSessionId: recoveryPlan.kind === "resume"
          ? recoveryPlan.externalSessionId
          : null,
        observedExternalSessionId,
        outcome: result.ok ? "succeeded" : "failed",
        recordedAt: this.nowIso(),
      });

      if (!result.ok) {
        const active = this.activeRuns.get(runId);
        if (
          executionInterruptionCauseForResult(result) === "runtime-closing"
          && active?.gracefulResumePrepared
        ) {
          await this.pauseRunLifecycle(runId);
        } else {
          await this.finishRunLifecycle(runId, runTimingStatusForFailedResult(result));
        }
        if (input.origin === "user-direct") {
          await this.recordFailedCodexResult(input.sourceMessage, input.sessionId, runId, result);
        } else {
          await this.recordDetachedWorkerResult(input.sessionId, runId, result);
        }
        return;
      }
      const terminalToolOnly = result.completionKind === "terminal-tool-result";
      await this.finishRunLifecycle(runId, "completed");
      if (recoveryStore !== null && executionContext.engine === "codex") {
        await this.storeCall("local-console-store-record-worker-codex-usage", () =>
          recoveryStore.recordCodexRunUsage({
            sessionId: input.sessionId,
            runId,
            cachedInputTokens: result.cachedInputTokens,
            recordedAt: this.nowIso(),
          }));
      }

      const sourceDirectoryAvailable = await this.sessionProjectDirectoryAvailable(input.sessionId);
      const childSessionCard = sourceDirectoryAvailable && !terminalToolOnly && input.role === "ceo"
        ? await this.executeLocalCeoChildSessionOrchestrationIfNeeded({
            sessionId: input.sessionId,
            runId,
            runDir: result.runDir,
            finalText: result.finalText,
            availableAgentNames: input.agentFiles.map((agent) => agent.name),
          })
        : null;

      if (sourceDirectoryAvailable) {
        await this.recordWorkspaceDiffIfNeeded(
          input.sessionId,
          runId,
          runDir,
          workspace,
          result.finalText,
          controller.signal,
        );
      }

      if (terminalToolOnly) {
        await this.storeCall("local-console-store-record-worker-tool-only-complete", () =>
          this.options.store.recordMessageProcessed({
            userMessageId: input.sourceMessage.id,
            sessionId: input.sessionId,
            runId,
            runDir: result.runDir,
            now: this.nowIso(),
          }),
        );
      } else if (input.origin === "user-direct") {
        await this.storeCall("local-console-store-record-direct-worker-response", () =>
          this.options.store.recordAgentResponse({
            userMessageId: input.sourceMessage.id,
            sessionId: input.sessionId,
            role: input.role,
            body: result.finalText,
            runId,
            runDir: result.runDir,
            now: this.nowIso(),
          }),
        );
      } else {
        const recordDetachedAgentResponse = this.options.store.recordDetachedAgentResponse;
        if (recordDetachedAgentResponse === undefined) {
          throw new Error("local console detached agent response store capability unavailable");
        }
        await this.storeCall("local-console-store-record-worker-response", () =>
          recordDetachedAgentResponse.call(this.options.store, {
            sessionId: input.sessionId,
            role: input.role,
            body: result.finalText,
            runId,
            runDir: result.runDir,
            now: this.nowIso(),
          }),
        );
      }
      await this.recordAgentTimelineCursor({
        sessionId: input.sessionId,
        runId,
        role: input.role,
        agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
        lastSeenIndex: input.timeline.at(-1)?.index ?? -1,
        recordedAt: this.nowIso(),
      });
      if (childSessionCard !== null) {
        await this.storeCall("local-console-store-worker-child-session-card", () =>
          this.sessionFactStore().recordChildSessionCard({
            parentSessionId: input.sessionId,
            sourceId: childSessionCard.sourceId,
            childSessionIds: childSessionCard.childSessionIds,
            runId,
            runDir: result.runDir,
            now: this.nowIso(),
          }));
      }
      this.lastError = null;
      if (!sourceDirectoryAvailable) {
        await this.storeCall("local-console-store-worker-directory-unavailable", () =>
          this.options.store.recordSystemMessage({
            sessionId: input.sessionId,
            body: "项目文件夹不可用；隔离工作区已完成当前步骤，修复项目文件夹后才能继续。",
            systemEventKind: "other",
            runId,
            runDir: result.runDir,
            error: "PROJECT_DIRECTORY_UNAVAILABLE",
            status: "failed",
            now: this.nowIso(),
          }),
        );
      }
    } catch (error) {
      this.lastError = formatLocalError(error);
      try {
        if (input.origin === "user-direct") {
          await this.recordTerminalFailureBestEffort(
            input.sourceMessage,
            input.sessionId,
            runId,
            runDir,
            this.lastError,
          );
        } else {
          await this.recordDetachedRunTerminal({
            sessionId: input.sessionId,
            body: "这一步没跑起来。你可以直接告诉主理人下一步怎么处理。",
            systemEventKind: "run-not-started",
            runId,
            runDir,
            error: this.lastError,
            status: "failed",
          });
        }
      } catch {
        // The original store failure remains the useful error.
      }
      throw error;
    } finally {
      const completedWorkspace = this.activeRuns.get(runId)?.cwd ?? null;
      const unfinished = this.activeRuns.get(runId);
      if (unfinished !== undefined && !unfinished.terminalRecorded) {
        try {
          if (unfinished.gracefulResumePrepared) {
            await this.pauseRunLifecycle(runId);
          } else {
            await this.finishRunLifecycle(runId, "failed");
          }
        } catch (error) {
          this.lastError = formatLocalError(error);
        }
      }
      this.activeRuns.delete(runId);
      if (completedWorkspace !== null) {
        invalidateLocalWorkspaceFacts(completedWorkspace);
      }
    }
  }

  private async recordDetachedRunTerminal(input: {
    sessionId: string;
    body: string;
    systemEventKind: LocalConsoleSystemEventKind;
    runId: string;
    runDir: string | null;
    error: string;
    status: "failed" | "interrupted" | "stuck";
    terminal?: LocalConsoleTerminal | null;
  }): Promise<void> {
    const recordDetachedRunTerminal = this.options.store.recordDetachedRunTerminal;
    if (recordDetachedRunTerminal === undefined) {
      await this.options.store.recordSystemMessage({
        ...input,
        now: this.nowIso(),
      });
      return;
    }
    await recordDetachedRunTerminal.call(this.options.store, {
      ...input,
      now: this.nowIso(),
    });
  }

  private async hasPersistedPrimaryRun(sessionId: string): Promise<boolean> {
    const messages = await this.storeCall("local-console-store-list-primary-running", () =>
      this.options.store.listMessages(sessionId),
    );
    return messages.some((message) =>
      message.speaker === "user"
      && message.status === "running"
      && message.dispatchLane !== "worker");
  }

  private async resolveUserMessageDispatch(sessionId: string, body: string) {
    const persistedSnapshot = await this.options.store.listSessionAgentTeamSnapshot?.(sessionId) ?? null;
    const agentNames = persistedSnapshot === null
      ? (await this.options.listAgentFiles(sessionId)).map((agent) => agent.name)
      : persistedSnapshot.members.map((member) => member.name);
    const primaryAgent = agentNames[0];
    if (primaryAgent === undefined) {
      throw new Error("Local console session has no primary Agent");
    }
    return resolveLocalUserMessageDispatch({
      body,
      availableAgentNames: agentNames,
      primaryAgent,
    });
  }

  async repairStaleRunning(sessionId = this.sessionId): Promise<number> {
    const staleThresholdMs = this.codexMaxDurationMs ?? this.codexIdleTimeoutMs ?? 10 * 60 * 1000;
    const cutoffIso = new Date(this.now().getTime() - staleThresholdMs - this.staleRunningGraceMs).toISOString();
    return await this.storeCall("local-console-store-mark-stale", () =>
      this.options.store.markStaleRunning({
        sessionId,
        cutoffIso,
        now: this.nowIso(),
        reason: `stale-running>${String(staleThresholdMs + this.staleRunningGraceMs)}ms`,
      }),
    );
  }

  private async defaultProjectId(): Promise<string> {
    const projects = await this.storeCall("local-console-store-list-projects", () => this.options.store.listProjects());
    return projects[0]?.projectId ?? LOCAL_CONSOLE_PROJECT_ID;
  }

  private async assertProjectDirectoryAvailable(projectId: string): Promise<void> {
    const project = await this.storedProject(projectId);
    if (project === undefined) {
      throw new LocalConsoleProjectFolderError("LOCAL_PROJECT_NOT_FOUND", "项目不存在或已移除");
    }
    if (!(await directoryAvailable(project.folderPath))) {
      throw new LocalConsoleProjectFolderError(
        "PROJECT_DIRECTORY_UNAVAILABLE",
        "当前项目本地文件夹不可用，请先使用红色扳手修复",
      );
    }
  }

  private async storedProject(projectId: string): Promise<LocalConsoleProjectSummary | undefined> {
    if (this.options.store.getProject !== undefined) {
      return (await this.storeCall("local-console-store-get-project", () =>
        this.options.store.getProject!(projectId)
      )) ?? undefined;
    }
    return (await this.storeCall("local-console-store-list-projects", () => this.options.store.listProjects()))
      .find((candidate) => candidate.projectId === projectId);
  }

  private async assertSessionProjectDirectoryAvailable(sessionId: string): Promise<void> {
    if (!(await this.sessionProjectDirectoryAvailable(sessionId))) {
      throw new LocalConsoleProjectFolderError(
        "PROJECT_DIRECTORY_UNAVAILABLE",
        "当前项目本地文件夹不可用，请先使用红色扳手修复",
      );
    }
  }

  private async assertSessionCanContinue(sessionId: string): Promise<void> {
    await this.assertSessionProjectDirectoryAvailable(sessionId);
    const session = (await this.storeCall("local-console-store-list-sessions", () => this.options.store.listSessions()))
      .find((candidate) => candidate.sessionId === sessionId);
    if (session === undefined) {
      throw new Error(`local console session not found: ${sessionId}`);
    }
    const healthy = await this.withAgentTeamHealth(session);
    const continuation = resolveLocalSessionContinuation({
      projectDirectoryAvailable: true,
      agentTeamHealth: healthy.agentTeamHealth,
      agentTeamHealthReason: healthy.agentTeamHealthReason,
    });
    if (!continuation.canContinue) {
      throw new Error(continuation.reason);
    }
  }

  private async continuableSessionWorkspace(sessionId: string): Promise<LocalConsoleSessionWorkspaceSource | null> {
    const source = await this.storeCall("local-console-store-session-workspace", () =>
      this.options.store.getSessionWorkspace(sessionId),
    );
    if (!(await directoryAvailable(source.folderPath))) {
      return null;
    }
    const session = source.session ?? (await this.storeCall(
      "local-console-store-list-sessions",
      () => this.options.store.listSessions(),
    )).find((candidate) => candidate.sessionId === sessionId);
    if (session === undefined) {
      return null;
    }
    const healthy = await this.withAgentTeamHealth(session);
    return healthy.agentTeamHealth === "deleted" || healthy.agentTeamHealth === "needs-repair" ? null : source;
  }

  private async sessionProjectDirectoryAvailable(sessionId: string): Promise<boolean> {
    const source = await this.storeCall("local-console-store-session-workspace", () =>
      this.options.store.getSessionWorkspace(sessionId),
    );
    return directoryAvailable(source.folderPath);
  }

  private async withDirectoryAvailability(
    project: LocalConsoleProjectSummary,
    knownAvailable?: boolean,
  ): Promise<LocalConsoleProjectSummary> {
    const available = knownAvailable ?? await directoryAvailable(project.folderPath);
    return {
      ...project,
      directoryAvailable: available,
      directoryUnavailableReason: available ? null : "当前项目本地文件夹未找到，可以指定新的文件夹",
      newConversationDisabledReason: available ? null : "当前项目本地文件夹不可用，无法新建对话",
    };
  }

  private async withAgentTeamHealth(session: LocalConsoleSessionSummary): Promise<LocalConsoleSessionSummary> {
    if (session.agentTeamOwnership == null || session.agentTeamId == null) {
      return { ...session, agentTeamHealth: null, agentTeamHealthReason: null };
    }
    if (this.options.resolveAgentTeamHealth === undefined) {
      return session;
    }
    try {
      const result = await this.options.resolveAgentTeamHealth(session);
      return { ...session, agentTeamHealth: result.health, agentTeamHealthReason: result.reason };
    } catch (error) {
      return {
        ...session,
        agentTeamHealth: "needs-repair",
        agentTeamHealthReason: formatLocalError(error),
      };
    }
  }

  private async withSessionWorkspaceContext(project: LocalConsoleProjectSummary): Promise<LocalConsoleProjectSummary> {
    const projectFacts = project.directoryAvailable === false
      ? { isGitRepository: false, branchName: null }
      : await readCachedLocalWorkspaceFacts({
          folderPath: project.folderPath,
          gitTimeoutMs: this.options.workspaceGitTimeoutMs,
        });
    const sessions = await Promise.all(project.sessions.map(async (session) => {
      const healthySession = await this.withAgentTeamHealth(session);
      const context = resolveSessionWorkspaceContext(session, projectFacts);
      const analysisRecordAvailable = await fileAvailable(this.getSessionFactLogPath(session.sessionId));
      let branchName = context.workspaceMode === "direct" ? projectFacts.branchName : null;
      if (context.workspaceMode === "worktree") {
        const worktreePath = localSessionWorktreePath(
          this.options.workdirRoot,
          project.projectId,
          session.sessionId,
        );
        if (await directoryAvailable(worktreePath)) {
          branchName = await readCachedLocalWorkspaceFacts({
            folderPath: worktreePath,
            gitTimeoutMs: this.options.workspaceGitTimeoutMs,
          }).then((facts) => facts.branchName, () => null);
        }
      }
      const continuation = resolveLocalSessionContinuation({
        projectDirectoryAvailable: project.directoryAvailable !== false,
        agentTeamHealth: healthySession.agentTeamHealth,
        agentTeamHealthReason: healthySession.agentTeamHealthReason,
      });
      const desiredAttentionKind = continuation.canContinue ? null : continuation.kind;
      const syncedAttention = this.options.store.syncSessionContinuationAttention === undefined
        || (healthySession.attentionKind ?? null) === desiredAttentionKind
        ? healthySession
        : await this.storeCall("local-console-store-sync-session-continuation-attention", () =>
          this.options.store.syncSessionContinuationAttention!({
            sessionId: session.sessionId,
            kind: desiredAttentionKind,
            now: this.nowIso(),
          }),
        );
      return {
        ...healthySession,
        attentionRevision: syncedAttention.attentionRevision,
        attentionAcknowledgedRevision: syncedAttention.attentionAcknowledgedRevision,
        attentionKind: syncedAttention.attentionKind,
        hasUnacknowledgedAttention: syncedAttention.hasUnacknowledgedAttention,
        analysisRecordAvailable,
        workspaceUnavailableReason: context.independentWorkspaceUnavailableReason,
        branchName,
        continuation,
      };
    }));
    return {
      ...project,
      branchName: projectFacts.branchName,
      isGitRepository: projectFacts.isGitRepository,
      sessions,
    };
  }

  private withRuntimeActivity(project: LocalConsoleProjectSummary): LocalConsoleProjectSummary {
    const sessions = project.sessions.map((session) => {
      const runs = this.activeRunsForSession(session.sessionId);
      const runningCount = Math.max(session.runningCount, runs.length);
      return {
        ...session,
        status: runningCount > 0 ? "running" as const : session.status,
        runningCount,
        hasPendingControlWork: session.hasPendingControlWork === true || runningCount > 0,
      };
    });
    return {
      ...project,
      sessions,
      runningCount: sessions.reduce((total, session) => total + session.runningCount, 0),
    };
  }

  private async synchronizeNonContinuableRecords(projects: LocalConsoleProjectSummary[]): Promise<void> {
    for (const session of projects.flatMap((project) => project.sessions)) {
      if (session.continuation === undefined || session.continuation.canContinue) {
        continue;
      }
      const continuation = session.continuation;
      const body = nonContinuableSystemMessage(continuation);
      if (body === null) {
        continue;
      }
      const messages = await this.storeCall("local-console-store-list", () => this.options.store.listMessages(session.sessionId));
      if (messages.some((message) => message.speaker === "system" && message.body === body)) {
        continue;
      }
      await this.storeCall("local-console-store-record-non-continuable", () => this.options.store.recordSystemMessage({
        sessionId: session.sessionId,
        body,
        systemEventKind: "other",
        runId: null,
        runDir: null,
        error: continuation.kind,
        status: "displayed",
        now: this.nowIso(),
      }));
    }
  }

  private async stopUnsafeRunsWithUnavailableContext(projects: LocalConsoleProjectSummary[]): Promise<void> {
    const unavailableProjectIds = new Set(
      projects.filter((project) => project.directoryAvailable === false).map((project) => project.projectId),
    );
    const sessions = new Map(projects.flatMap((project) => project.sessions.map((session) => [session.sessionId, session] as const)));
    for (const active of this.activeRuns.values()) {
      const source = await this.storeCall("local-console-store-session-workspace", () =>
        this.options.store.getSessionWorkspace(active.sessionId),
      );
      if (active.workspaceMode === "direct" && unavailableProjectIds.has(source.projectId)) {
        active.controller.abort("project-directory-unavailable");
        continue;
      }
      const session = sessions.get(active.sessionId);
      if (session?.agentTeamHealth === "deleted" || session?.agentTeamHealth === "needs-repair") {
        const snapshot = await this.options.store.listSessionAgentTeamSnapshot?.(active.sessionId) ?? null;
        if (snapshot === null) {
          active.controller.abort("agent-team-unavailable");
        }
      }
    }
  }

  private async resolveWorkspace(
    sessionId: string,
    source: LocalConsoleSessionWorkspaceSource,
    signal: AbortSignal,
  ): Promise<ResolvedLocalWorkspace> {
    const workspace = await resolveLocalWorkspaceSource({
      projectId: source.projectId,
      sessionId,
      folderPath: source.folderPath,
      worktreeMode: source.workspaceMode === "worktree",
      workdirRoot: this.options.workdirRoot,
      gitTimeoutMs: this.options.workspaceGitTimeoutMs,
      signal,
    });
    await this.storeCall("local-console-store-record-workspace", () =>
      this.options.store.recordProjectWorkspaceStatus({
        projectId: source.projectId,
        cwd: workspace.cwd,
        mode: workspace.mode,
        worktreePath: workspace.worktreePath,
        worktreeUnavailableReason: workspace.worktreeUnavailableReason,
        now: this.nowIso(),
      }),
    );
    return workspace;
  }

  private concurrentAgentHandoffRecoveryWorkspace(
    sessionId: string,
  ): ResolvedLocalWorkspace | null {
    const candidates = [...this.activeRuns.values()].filter((active) =>
      active.sessionId === sessionId
      && active.sourceDisposition === "agent-handoff"
      && active.resuming
      && active.cwd !== null
      && active.workspaceMode !== null);
    if (candidates.length !== 1) {
      return null;
    }
    const active = candidates[0];
    return {
      cwd: active.cwd!,
      mode: active.workspaceMode!,
      worktreePath: active.workspaceMode === "worktree" ? active.cwd : null,
      worktreeUnavailableReason: active.worktreeUnavailableReason,
      branchName: active.branchName,
      baseRef: active.baseRef,
      originalRepoRoot: active.originalRepoRoot,
    };
  }

  private async readConversationWorkspaceDiff(sessionId: string): Promise<LocalConsoleWorkspaceDiffSummary> {
    try {
      if (!this.conversationBaselineCommits.has(sessionId) && this.options.store.getSessionBaselineCommit !== undefined) {
        const baselineCommit = await this.storeCall("local-console-store-session-baseline", () =>
          this.options.store.getSessionBaselineCommit!(sessionId),
        );
        this.conversationBaselineCommits.set(sessionId, baselineCommit);
      }
      if (this.conversationBaselineCommits.get(sessionId) === null) {
        return { available: false, fileCount: null, reason: "missing-baseline" };
      }
      const context = await this.readConversationWorkspaceContext(sessionId);
      const diff = await readLocalConversationWorkspaceDiff({
        workspacePath: context.workspacePath,
        baselineCommit: context.baselineCommit,
        gitTimeoutMs: this.options.workspaceGitTimeoutMs,
      });
      return diff.available
        ? { available: true, fileCount: diff.fileCount, reason: null }
        : { available: false, fileCount: null, reason: diff.reason };
    } catch (error) {
      log({ event: "local-console-workspace-diff-count-unavailable", sessionId, error: formatLocalError(error) });
      return { available: false, fileCount: null, reason: "workspace-unavailable" };
    }
  }

  private async readConversationWorkspaceContext(sessionId: string): Promise<{
    workspacePath: string;
    workspaceMode: LocalConsoleWorkspaceMode;
    baselineCommit: string | null;
  }> {
    if (!this.conversationBaselineCommits.has(sessionId) && this.options.store.getSessionBaselineCommit !== undefined) {
      const baselineCommit = await this.storeCall("local-console-store-session-baseline", () =>
        this.options.store.getSessionBaselineCommit!(sessionId),
      );
      this.conversationBaselineCommits.set(sessionId, baselineCommit);
    }
    const source = await this.storeCall("local-console-store-session-workspace-files", () =>
      this.options.store.getSessionWorkspace(sessionId),
    );
    const baselineCommit = source.baselineCommit
      ?? this.conversationBaselineCommits.get(sessionId)
      ?? null;
    this.conversationBaselineCommits.set(sessionId, baselineCommit);
    return {
      workspacePath: source.workspaceMode === "worktree"
        ? localSessionWorktreePath(this.options.workdirRoot, source.projectId, sessionId)
        : source.folderPath,
      workspaceMode: source.workspaceMode,
      baselineCommit,
    };
  }

  private async readWorkspaceModeBestEffort(sessionId: string): Promise<LocalConsoleWorkspaceMode> {
    try {
      const source = await this.storeCall("local-console-store-session-workspace-mode", () =>
        this.options.store.getSessionWorkspace(sessionId),
      );
      return source.workspaceMode;
    } catch {
      return "direct";
    }
  }

  private async recordFailedCodexResult(
    message: LocalConsoleMessage,
    sessionId: string,
    runId: string,
    result: Extract<CodexRunResult, { ok: false }>,
  ): Promise<void> {
    const timeoutKind = executionTimeoutKind(result);
    if (timeoutKind !== null) {
      log({
        event: timeoutKind === "idle" ? "local-console-codex-idle-timeout" : "local-console-codex-watchdog-timeout",
        runDir: result.runDir,
        reason: result.reason,
      });
      await this.recordStuckBestEffort(
        message,
        sessionId,
        runId,
        result.runDir,
        result.reason,
        localTerminalFromResult(
          result,
          this.activeRuns.get(runId)?.liveMarkdown ?? null,
          this.activeRuns.get(runId)?.profile ?? null,
        ),
      );
      return;
    }
    if (isInterruptedCodexRunResult(result)) {
      const active = this.activeRuns.get(runId);
      const cause = executionInterruptionCauseForResult(result);
      if (cause === "runtime-closing" && active?.runId === runId && active.gracefulResumePrepared) {
        return;
      }
      await this.recordInterruptedBestEffort(
        message,
        sessionId,
        runId,
        result.runDir,
        result.reason,
        cause === "context-unavailable"
          ? "context-unavailable"
          : cause === "redirect"
            ? "redirect"
            : cause === "user"
              ? "user"
              : "system",
        localTerminalFromResult(
          result,
          this.activeRuns.get(runId)?.liveMarkdown ?? null,
          this.activeRuns.get(runId)?.profile ?? null,
        ),
      );
      return;
    }
    await this.recordTerminalFailureBestEffort(
      message,
      sessionId,
      runId,
      result.runDir,
      result.reason,
      result.failure?.message,
      localTerminalFromResult(
        result,
        this.activeRuns.get(runId)?.liveMarkdown ?? null,
        this.activeRuns.get(runId)?.profile ?? null,
      ),
    );
  }

  private async recordDetachedWorkerResult(
    sessionId: string,
    runId: string,
    result: Extract<CodexRunResult, { ok: false }>,
  ): Promise<void> {
    const active = this.activeRuns.get(runId);
    if (
      executionInterruptionCauseForResult(result) === "runtime-closing"
      && active?.gracefulResumePrepared
    ) {
      const messages = await this.storeCall("local-console-store-list-graceful-worker-placeholder", () =>
        this.options.store.listMessages(sessionId));
      const placeholder = messages.find((message) =>
        message.runId === runId
        && message.sourceKind === "local-worker-run");
      if (placeholder !== undefined) {
        await this.storeCall("local-console-store-release-graceful-worker-placeholder", () =>
          this.options.store.releaseMessageForRetry({
            userMessageId: placeholder.id,
            sessionId,
            now: this.nowIso(),
          }));
      }
      return;
    }
    const timeoutKind = executionTimeoutKind(result);
    if (timeoutKind !== null) {
      await this.storeCall("local-console-store-record-detached-worker-stuck", () =>
        this.recordDetachedRunTerminal({
          sessionId,
          body: result.terminal?.kind === "timeout" && result.terminal.basis === "tool"
            ? "这一步的工具调用运行过久，已经停下。你可以直接告诉主理人下一步怎么处理。"
            : "这一步卡住了。你可以直接告诉主理人下一步怎么处理。",
          systemEventKind: "run-stuck",
          runId,
          runDir: result.runDir,
          error: result.reason,
          status: "stuck",
          terminal: localTerminalFromResult(
            result,
            active?.liveMarkdown ?? null,
            active?.profile ?? null,
          ),
        }),
      );
      return;
    }
    if (isInterruptedCodexRunResult(result)) {
      const cause = executionInterruptionCauseForResult(result);
      const contextUnavailable = cause === "context-unavailable";
      const redirected = cause === "redirect";
      const systemStopped = cause === "runtime-closing" || cause === "system";
      await this.storeCall("local-console-store-record-detached-worker-interrupted", () =>
        this.recordDetachedRunTerminal({
          sessionId,
          body: contextUnavailable
            ? "这一步依赖的项目或团队内容已经不可用，因此已停止。已经产生的文件改动会保留。"
            : redirected
              ? "主理人发来了新的指令，当前这一步已经停下；这个成员会带着新指令重新开始。"
              : systemStopped
                ? "这一步被系统停止了。已经产生的文件改动会保留。"
              : "你让这一步停下了。已经产生的文件改动会保留。",
          systemEventKind: redirected || contextUnavailable || systemStopped ? "other" : "user-stopped",
          runId,
          runDir: result.runDir,
          error: result.reason,
          status: "interrupted",
          terminal: localTerminalFromResult(
            result,
            active?.liveMarkdown ?? null,
            active?.profile ?? null,
          ),
        }),
      );
      return;
    }
    await this.storeCall("local-console-store-record-detached-worker-failed", () =>
      this.recordDetachedRunTerminal({
        sessionId,
        body: result.failure?.message
          ?? "这一步没跑起来。你可以直接告诉主理人下一步怎么处理。",
        systemEventKind: "run-not-started",
        runId,
        runDir: result.runDir,
        error: result.reason,
        status: "failed",
        terminal: localTerminalFromResult(
          result,
          active?.liveMarkdown ?? null,
          active?.profile ?? null,
        ),
      }),
    );
  }

  private async recordNoTrigger(message: LocalConsoleMessage, sessionId: string, runId: string): Promise<void> {
    if (message.speaker === "agent") {
      await this.storeCall("local-console-store-no-trigger-agent", () =>
        this.options.store.recordMessageProcessed({
          userMessageId: message.id,
          sessionId,
          runId,
          runDir: null,
          now: this.nowIso(),
        }),
      );
      return;
    }
    await this.storeCall("local-console-store-no-trigger", () =>
      this.options.store.recordSystemAndComplete({
        userMessageId: message.id,
        sessionId,
        body: "没有找到可以接手这条消息的团队成员。请改选一支可用团队后再试。",
        systemEventKind: "other",
        runId,
        runDir: null,
        now: this.nowIso(),
      }),
    );
  }

  private async releaseForRetryBestEffort(message: LocalConsoleMessage, sessionId: string): Promise<void> {
    try {
      await this.storeCall("local-console-store-release-retry", () =>
        this.options.store.releaseMessageForRetry({
          userMessageId: message.id,
          sessionId,
          now: this.nowIso(),
        }),
      );
    } catch (error) {
      this.lastError = formatLocalError(error);
      log({ event: "local-console-release-retry-failed", error: this.lastError });
    }
  }

  private activeRunsForSession(sessionId: string): ActiveLocalRun[] {
    return [...this.activeRuns.values()]
      .filter((active) => active.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.runId.localeCompare(right.runId));
  }

  private hasActiveRunForSession(sessionId: string): boolean {
    return this.activeRunsForSession(sessionId).length > 0;
  }

  private activeRunForLane(sessionId: string, lane: ActiveLocalRun["lane"]): ActiveLocalRun | undefined {
    return this.activeRunsForSession(sessionId).find((active) => active.lane === lane);
  }

  private activeRunForRole(sessionId: string, role: string): ActiveLocalRun | undefined {
    return this.activeRunsForSession(sessionId).find((active) => active.role === role);
  }

  private async activeRunSnapshots(sessionId: string): Promise<LocalConsoleRunSnapshot[]> {
    return await Promise.all(
      this.activeRunsForSession(sessionId).map((active) => this.snapshotActiveRun(active)),
    );
  }

  private async gracefulResumeTargetsForClaim(
    sessionId: string,
  ): Promise<Array<{ sourceMessageId: number; targetRunId: string }>> {
    const recoveryStore = this.codexRecoveryFactStore();
    if (recoveryStore === null) return [];
    const recoveryFacts = await readLocalCodexRecoveryFacts(
      recoveryStore.getSessionFactLogPath(sessionId),
      sessionId,
    );
    const bySource = new Map<number, Set<string>>();
    for (const intent of recoveryFacts.intents) {
      if (
        intent.reason !== "graceful-shutdown"
        || recoveryFacts.consumedIntentIds.has(intent.intentId)
      ) {
        continue;
      }
      const targets = bySource.get(intent.sourceMessageId) ?? new Set<string>();
      targets.add(intent.targetRunId);
      bySource.set(intent.sourceMessageId, targets);
    }
    return [...bySource.entries()]
      .filter(([, targetRunIds]) => targetRunIds.size === 1)
      .map(([sourceMessageId, targetRunIds]) => ({
        sourceMessageId,
        targetRunId: [...targetRunIds][0]!,
      }));
  }

  private async gracefulResumeTargetForMessage(
    sessionId: string,
    sourceMessageId: number,
    knownRecoveryFacts?: Awaited<ReturnType<typeof readLocalCodexRecoveryFacts>>,
  ): Promise<string | null> {
    const recoveryStore = this.codexRecoveryFactStore();
    if (recoveryStore === null) return null;
    const recoveryFacts = knownRecoveryFacts
      ?? await readLocalCodexRecoveryFacts(recoveryStore.getSessionFactLogPath(sessionId), sessionId);
    const intent = [...recoveryFacts.intents].reverse().find((candidate) =>
      candidate.reason === "graceful-shutdown"
      && candidate.sourceMessageId === sourceMessageId
      && !recoveryFacts.consumedIntentIds.has(candidate.intentId));
    return intent?.targetRunId ?? null;
  }

  private async snapshotActiveRun(active: ActiveLocalRun): Promise<LocalConsoleRunSnapshot> {
    const tail = await readLocalConsoleOutputTail(active.runDir);
    const elapsedMs = active.startedAt === null ? null : this.activeRunElapsedMs(active);
    if (
      !active.longRunReported
      && elapsedMs !== null
      && elapsedMs >= LOCAL_LONG_RUN_REPORT_MS
    ) {
      active.longRunReported = true;
      const cursor = ++active.activitySequence;
      const elapsedMinutes = Math.max(1, Math.floor(elapsedMs / 60_000));
      const previousActivity = active.activity;
      this.acceptRunActivity(active, {
        cursor,
        kind: "progress",
        phase: "running",
        action: `已经运行 ${String(elapsedMinutes)} 分钟，${previousActivity?.action ?? "仍在继续"}`,
        object: previousActivity?.object ?? null,
        occurredAt: this.nowIso(),
      });
    }
    return {
      sessionId: active.sessionId,
      runId: active.runId,
      role: active.role,
      status: "running",
      createdAt: active.createdAt,
      startedAt: active.startedAt,
      elapsedMs,
      stepId: active.stepId,
      attempt: active.attempt,
      engine: active.engine,
      processOutputAvailable: active.processOutputAvailable,
      activity: active.activity,
      runDir: active.runDir,
      cwd: active.cwd,
      workspaceMode: active.workspaceMode,
      worktreeUnavailableReason: active.worktreeUnavailableReason,
      branchName: active.branchName,
      baseRef: active.baseRef,
      stdoutTail: tail.stdoutTail,
      stderrTail: tail.stderrTail,
      liveMarkdown: active.liveMarkdown,
      lastOutputSummary: tail.lastOutputSummary,
      tailDiagnostic: tail.tailDiagnostic,
      interruptible: true,
    };
  }

  private async markRunStarted(runId: string): Promise<void> {
    const active = this.activeRuns.get(runId);
    if (active === undefined || active.segmentStartedAt !== null) return;
    const startedAt = this.nowIso();
    active.segmentStartedAt = startedAt;
    active.startedAt ??= startedAt;
    await this.recordRunLifecycle(
      active,
      active.resuming ? "resumed" : "started",
      "running",
    );
  }

  private updateStructuredRunActivity(runId: string, event: unknown): void {
    const active = this.activeRuns.get(runId);
    if (active === undefined) return;
    const cursor = ++active.activitySequence;
    const activity = projectStructuredRunActivity(event, cursor, this.nowIso());
    if (activity !== null) this.acceptRunActivity(active, activity);
  }

  private updateExecutionProgressActivity(
    runId: string,
    event: ExecutionProgressEvent,
  ): void {
    if (event.kind !== "provider-retry") return;
    const active = this.activeRuns.get(runId);
    if (active === undefined) return;
    const cursor = ++active.activitySequence;
    this.acceptRunActivity(active, {
      cursor,
      kind: "progress",
      phase: "running",
      action: event.attempt === undefined
        ? "对方服务繁忙，正在重试"
        : `对方服务繁忙，正在第 ${String(event.attempt)} 次重试`,
      object: null,
      occurredAt: this.nowIso(),
    });
  }

  private updateAgentProgressActivity(runId: string, markdown: string): void {
    const active = this.activeRuns.get(runId);
    if (active === undefined) return;
    const cursor = ++active.activitySequence;
    const activity = projectAgentProgressActivity(markdown, cursor, this.nowIso());
    if (activity !== null) this.acceptRunActivity(active, activity);
  }

  private acceptRunActivity(active: ActiveLocalRun, activity: LocalRunActivity): void {
    const next = chooseLatestRunActivity(active.activity, activity);
    if (next === active.activity) return;
    active.activity = next;
    const lifecycleStore = this.runLifecycleFactStore();
    if (lifecycleStore === null) return;
    active.activityFactTail = active.activityFactTail.then(() =>
      this.storeCall("local-console-store-record-run-activity", () =>
        lifecycleStore.recordRunActivityEvent({
          sessionId: active.sessionId,
          runId: active.runId,
          activity: next,
        }))).catch((error: unknown) => {
          this.lastError = formatLocalError(error);
        });
  }

  private async finishRunLifecycle(
    runId: string,
    status: import("./types.js").LocalConsoleRunTiming["status"],
  ): Promise<void> {
    const active = this.activeRuns.get(runId);
    if (active === undefined || active.terminalRecorded) return;
    active.terminalRecorded = true;
    await active.activityFactTail;
    await this.recordRunLifecycle(active, "terminal", status);
  }

  private async pauseRunLifecycle(runId: string): Promise<void> {
    const active = this.activeRuns.get(runId);
    if (active === undefined || active.terminalRecorded) return;
    active.terminalRecorded = true;
    await active.activityFactTail;
    await this.recordRunLifecycle(active, "paused", "paused");
  }

  private async recordRunLifecycle(
    active: ActiveLocalRun,
    phase: "created" | "started" | "paused" | "resumed" | "terminal",
    status: import("./types.js").LocalConsoleRunTiming["status"],
  ): Promise<void> {
    const lifecycleStore = this.runLifecycleFactStore();
    if (lifecycleStore === null) return;
    const recordedAt = this.nowIso();
    const elapsedMs = active.startedAt === null ? null : this.activeRunElapsedMs(active);
    await this.storeCall("local-console-store-record-run-lifecycle", () =>
      lifecycleStore.recordRunLifecycleEvent({
        sessionId: active.sessionId,
        runId: active.runId,
        stepId: active.stepId,
        attempt: active.attempt,
        phase,
        role: active.role,
        engine: active.engine,
        processOutputAvailable: active.processOutputAvailable,
        createdAt: active.createdAt,
        startedAt: active.startedAt,
        elapsedMs: phase === "paused" || phase === "resumed" || phase === "terminal"
          ? elapsedMs
          : null,
        completedAt: phase === "terminal" && status !== "paused" ? recordedAt : null,
        status,
        recordedAt,
      }));
  }

  private activeRunElapsedMs(active: ActiveLocalRun): number {
    const segmentElapsedMs = active.segmentStartedAt === null
      ? 0
      : Math.max(0, this.now().getTime() - Date.parse(active.segmentStartedAt));
    return active.accumulatedMs + segmentElapsedMs;
  }

  private async prepareRunLifecycle(input: {
    sessionId: string;
    runId: string;
    stepId: string;
    resumeExisting: boolean;
  }): Promise<{
    attempt: number;
    createdAt: string;
    startedAt: string | null;
    accumulatedMs: number;
    resuming: boolean;
  }> {
    const lifecycleStore = this.runLifecycleFactStore();
    if (input.resumeExisting && lifecycleStore !== null) {
      const timing = await this.storeCall(
        "local-console-store-get-run-timing",
        () => lifecycleStore.getRunTiming({
          sessionId: input.sessionId,
          runId: input.runId,
        }),
      );
      if (timing !== null && timing.stepId === input.stepId) {
        return {
          attempt: timing.attempt,
          createdAt: timing.createdAt,
          startedAt: timing.startedAt,
          accumulatedMs: timing.elapsedMs ?? 0,
          resuming: true,
        };
      }
    }
    return {
      attempt: await this.nextRunAttempt({
        sessionId: input.sessionId,
        stepId: input.stepId,
      }),
      createdAt: this.nowIso(),
      startedAt: null,
      accumulatedMs: 0,
      resuming: false,
    };
  }

  private async nextRunAttempt(input: { sessionId: string; stepId: string }): Promise<number> {
    const lifecycleStore = this.runLifecycleFactStore();
    return lifecycleStore === null
      ? 1
      : await this.storeCall(
          "local-console-store-next-run-attempt",
          () => lifecycleStore.nextRunAttempt(input),
        );
  }

  private async applyPendingSessionContextWhenIdle(sessionId: string): Promise<void> {
    const hasScheduledWorker = [...this.workerLaneTails.keys()].some((key) =>
      key.startsWith(`${sessionId}\u0000`),
    );
    if (this.hasActiveRunForSession(sessionId) || hasScheduledWorker) {
      return;
    }
    const messages = await this.storeCall("local-console-store-list-before-context-promotion", () =>
      this.options.store.listMessages(sessionId));
    if (messages.some((message) =>
      message.speaker === "user"
      && (message.status === "pending" || message.status === "running")
      && message.dispatchLane === "worker")) {
      return;
    }
    await this.storeCall("local-console-store-apply-pending-session-context", () =>
      this.options.store.applyPendingSessionContext({ sessionId, now: this.nowIso() }),
    );
    const awaiting = messages.filter((message) =>
      message.speaker === "user"
      && message.status === "pending"
      && message.dispatchLane === "awaiting-team");
    if (awaiting.length === 0) {
      return;
    }
    const resolveAwaiting = this.options.store.resolveAwaitingUserMessageDispatches;
    if (resolveAwaiting === undefined) {
      throw new Error("local console awaiting dispatch persistence capability unavailable");
    }
    const persistedSnapshot = await this.options.store.listSessionAgentTeamSnapshot?.(sessionId) ?? null;
    const agentNames = persistedSnapshot === null
      ? (await this.options.listAgentFiles(sessionId)).map((agent) => agent.name)
      : persistedSnapshot.members.map((member) => member.name);
    const primaryAgent = agentNames[0];
    if (primaryAgent === undefined) {
      return;
    }
    await this.storeCall("local-console-store-resolve-awaiting-dispatches", () =>
      resolveAwaiting.call(this.options.store, {
        sessionId,
        dispatches: awaiting.map((message) => ({
          messageId: message.id,
          ...resolveLocalUserMessageDispatch({
            body: message.body,
            availableAgentNames: agentNames,
            primaryAgent,
          }),
        })),
        now: this.nowIso(),
      }));
  }

  private async recordTerminalFailureBestEffort(
    message: LocalConsoleMessage,
    sessionId: string,
    runId: string | null,
    runDir: string | null,
    error: string,
    body?: string,
    terminal?: LocalConsoleTerminal | null,
  ): Promise<void> {
    try {
      await this.storeCall("local-console-store-record-failure", () =>
        this.options.store.recordFailure({
          userMessageId: message.id,
          sessionId,
          error,
          runId,
          runDir,
          now: this.nowIso(),
          ...(body === undefined ? {} : { body }),
          ...(terminal == null ? {} : { terminal }),
        }),
      );
    } catch (recordError) {
      this.lastError = formatLocalError(recordError);
      log({ event: "local-console-record-retryable-failure-failed", error: this.lastError, originalError: error });
      await this.releaseForRetryBestEffort(message, sessionId);
    }
  }

  private async settleUnavailableResume(input: {
    sessionId: string;
    runId: string;
    sourceMessage: LocalConsoleMessage;
    intent: LocalCodexResumeIntentFact | null;
    role: string;
    engine: "codex" | "claude" | "kimi";
    reason: string;
    runDir: string | null;
  }): Promise<void> {
    if (input.intent !== null) {
      const recoveryStore = this.requireCodexRecoveryFactStore();
      await this.storeCall("local-console-store-consume-unavailable-resume", () =>
        recoveryStore.recordCodexResumeConsumed({
          sessionId: input.sessionId,
          intentId: input.intent!.intentId,
          resumedByRunId: input.runId,
          mode: "unavailable",
          reason: input.reason,
          consumedAt: this.nowIso(),
        }));
    }
    const lifecycleStore = this.runLifecycleFactStore();
    if (lifecycleStore !== null) {
      const timing = await this.storeCall(
        "local-console-store-read-unavailable-resume-timing",
        () => lifecycleStore.getRunTiming({
          sessionId: input.sessionId,
          runId: input.runId,
        }),
      );
      if (timing !== null) {
        const completedAt = this.nowIso();
        await this.storeCall("local-console-store-record-unavailable-resume-terminal", () =>
          lifecycleStore.recordRunLifecycleEvent({
            sessionId: input.sessionId,
            runId: input.runId,
            stepId: timing.stepId,
            attempt: timing.attempt,
            phase: "terminal",
            role: input.role,
            engine: input.engine,
            processOutputAvailable: timing.processOutputAvailable,
            createdAt: timing.createdAt,
            startedAt: timing.startedAt,
            elapsedMs: timing.elapsedMs,
            completedAt,
            status: "failed",
            recordedAt: completedAt,
          }));
      }
    }
    await this.storeCall("local-console-store-record-unavailable-resume", () =>
      this.options.store.recordFailure({
        userMessageId: input.sourceMessage.id,
        sessionId: input.sessionId,
        error: `resume-unavailable:${input.reason}`,
        runId: input.runId,
        runDir: input.runDir,
        body: "原执行已经无法继续。你可以重新运行，或直接说话、换一个成员接手。",
        // SQLite keeps the legacy bounded enum; the public DTO derives the
        // specific recovery fact from this stable error prefix.
        systemEventKind: "other",
        now: this.nowIso(),
      }));
  }

  private async recordInterruptedBestEffort(
    message: LocalConsoleMessage,
    sessionId: string,
    runId: string | null,
    runDir: string | null,
    reason: string,
    interruptionKind: "user" | "redirect" | "context-unavailable" | "system" = "user",
    terminal?: LocalConsoleTerminal | null,
  ): Promise<void> {
    try {
      await this.storeCall("local-console-store-record-interrupted", () =>
        this.options.store.recordInterrupted({
          userMessageId: message.id,
          sessionId,
          reason,
          interruptionKind,
          runId,
          runDir,
          now: this.nowIso(),
          ...(terminal == null ? {} : { terminal }),
        }),
      );
    } catch (recordError) {
      this.lastError = formatLocalError(recordError);
      log({ event: "local-console-record-interrupted-failed", error: this.lastError, originalError: reason });
    }
  }

  private async recordStuckBestEffort(
    message: LocalConsoleMessage,
    sessionId: string,
    runId: string | null,
    runDir: string | null,
    reason: string,
    terminal?: LocalConsoleTerminal | null,
  ): Promise<void> {
    try {
      await this.storeCall("local-console-store-record-stuck", () =>
        this.options.store.recordStuck({
          userMessageId: message.id,
          sessionId,
          reason,
          runId,
          runDir,
          now: this.nowIso(),
          ...(terminal == null ? {} : { terminal }),
        }),
      );
    } catch (recordError) {
      this.lastError = formatLocalError(recordError);
      log({ event: "local-console-record-stuck-failed", error: this.lastError, originalError: reason });
    }
  }

  private async recordVisibleChildSessionFailureBestEffort(parentSessionId: string, reason: string): Promise<void> {
    try {
      await this.storeCall("local-console-store-child-session-failure", () =>
        this.options.store.recordSystemMessage({
          sessionId: parentSessionId,
          body: "子任务没有创建成功。你可以继续说话，或换一个成员接手。",
          systemEventKind: "run-not-started",
          runId: `local-child-session-${this.now().toISOString()}`,
          runDir: null,
          error: reason,
          status: "failed",
          now: this.nowIso(),
        }),
      );
    } catch (error) {
      this.lastError = formatLocalError(error);
      log({ event: "local-console-child-session-failure-record-failed", error: this.lastError, originalError: reason });
    }
  }

  private async executeLocalCeoChildSessionOrchestrationIfNeeded(input: {
    sessionId: string;
    runId: string;
    runDir: string;
    finalText: string;
    availableAgentNames: string[];
  }): Promise<{ sourceId: string; childSessionIds: string[] } | null> {
    const visibleTaskIds = collectLocalCeoLedgerTaskIds(input.finalText);
    if (visibleTaskIds.length === 0) {
      return null;
    }
    const scripts = await loadCeoScripts({ agentsDir: path.join(this.options.projectRoot, "agents"), required: false });
    const parsed = parseCeoOrchestrationOutput({
      output: input.finalText,
      scripts,
      availableAgentNames: input.availableAgentNames,
      visibleTaskIds,
      childTaskCheckPolicy: "local-optional",
    });
    if (!parsed.ok) {
      return null;
    }
    const descriptors =
      parsed.value.action === "spawn_child_issues"
        ? { workflowId: parsed.value.workflowId, groups: parsed.value.groups, issues: parsed.value.issues }
        : parsed.value.action === "goal_intake" && parsed.value.mode === "confirm"
          ? { workflowId: parsed.value.workflowId, groups: parsed.value.groups, issues: parsed.value.issues }
          : null;
    if (descriptors === null || descriptors.issues.length === 0) {
      return null;
    }

    const workspace = await this.storeCall("local-console-store-session-workspace", () => this.options.store.getSessionWorkspace(input.sessionId));
    const created: LocalConsoleSessionSummary[] = [];
    for (const descriptor of descriptors.issues) {
      const group = descriptors.groups.find((entry) => entry.id === descriptor.groupId);
      if (group === undefined) {
        throw new Error(`local child orchestration missing group: ${descriptor.groupId}`);
      }
      const hiddenKey = localOrchestrationKey({
        parentSessionId: input.sessionId,
        workflowId: descriptors.workflowId,
        ledgerTaskId: descriptor.ledgerTaskId,
      });
      created.push(
        await this.createChildSession({
          parentSessionId: input.sessionId,
          childSessionId: localChildSessionId(input.sessionId, descriptor.ledgerTaskId),
          projectId: workspace.projectId,
          title: descriptor.title,
          relation: "task",
          hiddenKey,
          initialRole: descriptor.initialRole,
          initialBody: renderLocalChildSessionInitialBody({
            parentSessionId: input.sessionId,
            workflowId: descriptors.workflowId,
            group,
            descriptor,
            orchestrationKey: hiddenKey,
          }),
        }),
      );
    }
    for (const child of created) {
      void this.processPending(child.sessionId);
    }
    return {
      sourceId: `workflow:${descriptors.workflowId}`,
      childSessionIds: created.map((child) => child.sessionId),
    };
  }

  private async recordWorkspaceDiffIfNeeded(
    sessionId: string,
    runId: string,
    runDir: string,
    workspace: ResolvedLocalWorkspace,
    finalText: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (workspace.mode !== "worktree" || workspace.worktreePath === null) {
      return;
    }
    if (parseTrailingStageMarker(finalText) !== "code-verified") {
      return;
    }
    try {
      const originalStatus = workspace.originalRepoRoot === null
        ? ""
        : await readLocalGitStatus({
          folderPath: workspace.originalRepoRoot,
          gitTimeoutMs: this.options.workspaceGitTimeoutMs,
          signal,
        });
      if (originalStatus !== "") {
        throw new Error(`original-repo-dirty-before-diff:${originalStatus}`);
      }
      const diff = await generateLocalWorkspaceDiff({
        worktreePath: workspace.worktreePath,
        runDir,
        baseRef: workspace.baseRef,
        branchName: workspace.branchName,
        originalRepoRoot: workspace.originalRepoRoot,
        gitTimeoutMs: this.options.workspaceGitTimeoutMs,
        signal,
      });
      await this.storeCall("local-console-store-record-workspace-diff", () =>
        this.sessionFactStore().recordWorkspaceDiff({
          sessionId,
          runId,
          originalRepoRoot: workspace.originalRepoRoot,
          baseRef: diff.baseRef,
          branchName: diff.branchName,
          worktreePath: diff.worktreePath,
          patchPath: diff.patchPath,
          affectedFiles: diff.affectedFiles,
          status: "generated",
          error: null,
          now: this.nowIso(),
        }),
      );
    } catch (error) {
      const message = formatLocalError(error);
      log({ event: "local-console-workspace-diff-failed", error: message, sessionId, runId });
      await this.sessionFactStore().recordWorkspaceDiff({
        sessionId,
        runId,
        originalRepoRoot: workspace.originalRepoRoot,
        baseRef: workspace.baseRef ?? "unknown",
        branchName: workspace.branchName ?? "unknown",
        worktreePath: workspace.worktreePath,
        patchPath: path.join(runDir, "workspace.patch"),
        affectedFiles: [],
        status: "failed",
        error: message,
        now: this.nowIso(),
      });
    }
  }

  private async storeCall<T>(label: string, operation: () => Promise<T>): Promise<T> {
    return await withLocalConsoleTimeout(Promise.resolve().then(operation), this.storeTimeoutMs, label);
  }

  private async recordRunExecutionContext(
    input: LocalRunExecutionContextFact,
  ): Promise<void> {
    const record = this.options.store.recordRunExecutionContext;
    if (record === undefined) {
      return;
    }
    await this.storeCall("local-console-store-record-run-execution-context", () =>
      record.call(this.options.store, input));
  }

  private async recordExecutionSessionLink(
    input: LocalExecutionSessionLinkFact,
  ): Promise<void> {
    const record = this.options.store.recordExecutionSessionLink;
    if (record === undefined) {
      return;
    }
    await this.storeCall("local-console-store-record-execution-session-link", () =>
      record.call(this.options.store, input));
  }

  private async recordAgentSessionLink(input: LocalAgentSessionLinkFact): Promise<void> {
    const store = this.requireCodexRecoveryFactStore();
    await this.storeCall("local-console-store-record-agent-session-link", () =>
      store.recordAgentSessionLink(input));
  }

  private async recordProviderSessionObserved(
    input: LocalProviderSessionObservedFact,
  ): Promise<void> {
    const store = this.requireCodexRecoveryFactStore();
    await this.storeCall("local-console-store-record-provider-session-observed", () =>
      store.recordProviderSessionObserved(input));
  }

  private async recordAgentTimelineCursor(input: LocalAgentTimelineCursorFact): Promise<void> {
    const store = this.requireCodexRecoveryFactStore();
    await this.storeCall("local-console-store-record-agent-timeline-cursor", () =>
      store.recordAgentTimelineCursor(input));
  }

  private async recordProviderInvocation(input: LocalProviderInvocationFact): Promise<void> {
    const store = this.requireCodexRecoveryFactStore();
    await this.storeCall("local-console-store-record-provider-invocation", () =>
      store.recordProviderInvocation(input));
  }

  private async recordCodexThreadLink(input: {
    sessionId: string;
    runId: string;
    sourceMessageId: number;
    role: string;
    threadId: string;
    startedAt: string;
    contextFingerprint: string;
  }): Promise<void> {
    const record = this.options.store.recordCodexThreadLink;
    if (record === undefined) {
      throw new Error("local console store does not provide Codex thread link persistence");
    }
    await this.storeCall("local-console-store-record-codex-thread-link", () =>
      record.call(this.options.store, input));
  }

  private sessionFactStore(): SessionFactWritingStore {
    const store = this.options.store as Partial<SessionFactWritingStore> & LocalConsoleStore;
    if (
      typeof store.createChildSession !== "function" ||
      typeof store.recordChildSessionCard !== "function" ||
      typeof store.recordWorkspaceDiff !== "function" ||
      typeof store.recordProgressEvent !== "function" ||
      typeof store.getSessionFactLogPath !== "function"
    ) {
      throw new Error("local console store does not provide the session fact write funnel");
    }
    return store as SessionFactWritingStore;
  }

  private runLifecycleFactStore(): RunLifecycleFactStore | null {
    const store = this.options.store as Partial<RunLifecycleFactStore> & LocalConsoleStore;
    if (
      typeof store.nextRunAttempt !== "function"
      || typeof store.getRunTiming !== "function"
      || typeof store.recordRunLifecycleEvent !== "function"
      || typeof store.recordRunActivityEvent !== "function"
    ) {
      return null;
    }
    return store as RunLifecycleFactStore;
  }

  private codexRecoveryFactStore(): CodexRecoveryFactStore | null {
    const store = this.options.store as Partial<CodexRecoveryFactStore> & LocalConsoleStore;
    if (
      typeof store.getSessionFactLogPath !== "function" ||
      typeof store.recordCodexResumeIntent !== "function" ||
      typeof store.recordCodexResumeConsumed !== "function" ||
      typeof store.recordCodexRunUsage !== "function" ||
      typeof store.recordAgentSessionLink !== "function" ||
      typeof store.recordProviderSessionObserved !== "function" ||
      typeof store.recordAgentTimelineCursor !== "function" ||
      typeof store.recordProviderInvocation !== "function"
    ) {
      return null;
    }
    return store as CodexRecoveryFactStore;
  }

  private requireCodexRecoveryFactStore(): CodexRecoveryFactStore {
    const store = this.codexRecoveryFactStore();
    if (store === null) {
      throw new Error("local console store does not provide Codex recovery fact persistence");
    }
    return store;
  }

  private nowIso(): string {
    return this.now().toISOString();
  }
}

function workspaceFromExecutionContext(
  context: LocalRunExecutionContextFact,
): ResolvedLocalWorkspace {
  return {
    cwd: path.resolve(context.workspace.cwd),
    mode: context.workspace.mode === "worktree" ? "worktree" : "direct",
    worktreePath: context.workspace.worktreePath,
    worktreeUnavailableReason: context.workspace.worktreeUnavailableReason,
    branchName: context.workspace.branchName,
    baseRef: context.workspace.baseRef,
    originalRepoRoot: context.workspace.originalRepoRoot,
  };
}

function exactGracefulRecoveryContext(input: {
  sessionId: string;
  runId: string;
  sourceMessageId: number;
  role: string;
  intents: readonly LocalCodexResumeIntentFact[];
  consumedIntentIds: ReadonlySet<string>;
  contexts: readonly LocalRunExecutionContextFact[];
}): {
  context: LocalRunExecutionContextFact;
  intent: LocalCodexResumeIntentFact;
} | null {
  const intents = input.intents.filter((intent) =>
    intent.reason === "graceful-shutdown"
    && intent.targetRunId === input.runId
    && intent.sourceMessageId === input.sourceMessageId
    && intent.role === input.role
    && !input.consumedIntentIds.has(intent.intentId));
  if (intents.length !== 1) {
    return null;
  }
  const relatedContexts = input.contexts.filter((context) =>
    context.runId === input.runId
    || context.sourceMessageId === input.sourceMessageId);
  if (
    relatedContexts.length !== 1
    || relatedContexts[0]?.sessionId !== input.sessionId
    || relatedContexts[0]?.runId !== input.runId
    || relatedContexts[0]?.sourceMessageId !== input.sourceMessageId
    || relatedContexts[0]?.role !== input.role
  ) {
    return null;
  }
  return {
    context: relatedContexts[0],
    intent: intents[0],
  };
}

async function defaultCodexThreadAvailability(threadId: string): Promise<boolean> {
  return (await resolveCodexRollout(threadId)).status === "available";
}

function buildFallbackProjectSummary(projectRoot: string): LocalConsoleProjectSummary {
  return {
    projectId: "local",
    sourceType: "local-folder",
    title: path.basename(projectRoot) || projectRoot,
    folderPath: projectRoot,
    worktreeMode: false,
    workspaceCwd: projectRoot,
    workspaceMode: "direct",
    worktreePath: null,
    worktreeUnavailableReason: null,
    workspaceUpdatedAt: null,
    sessions: [],
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
  };
}

function noSessionWorkspaceDiff(): LocalConsoleWorkspaceDiffSummary {
  return { available: false, fileCount: null, reason: "no-session" };
}

async function readOptionalTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function normalizeTitle(title: string | undefined): string {
  const trimmed = title?.trim();
  if (trimmed === undefined || trimmed === "") {
    return "新会话";
  }
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}...` : trimmed;
}

export async function withLocalConsoleTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new LocalConsoleStoreTimeoutError(label, timeoutMs)), timeoutMs);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  }
}

export function formatLocalError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runTimingStatusForFailedResult(
  result: Extract<CodexRunResult, { ok: false }>,
): import("./types.js").LocalConsoleRunTiming["status"] {
  if (executionInterruptionCauseForResult(result) === "runtime-closing") return "paused";
  if (executionTimeoutKind(result) !== null) return "stuck";
  return isInterruptedCodexRunResult(result) ? "interrupted" : "failed";
}

function localTerminalFromResult(
  result: Extract<CodexRunResult, { ok: false }>,
  fallbackPartialMarkdown: string | null,
  actualProfile: LocalConsoleExecutionProfile | null,
): LocalConsoleTerminal {
  const partialMarkdown = result.terminal?.partialText.trim().length
    ? result.terminal.partialText
    : fallbackPartialMarkdown ?? "";
  if (result.terminal === undefined) {
    return {
      kind: "crashed",
      subkind: null,
      safeCode: "legacy-run-failure",
      retryable: null,
      partialMarkdown,
      contentIncomplete: true,
      actualProfile,
    };
  }
  switch (result.terminal.kind) {
    case "interrupted":
      return {
        kind: "interrupted",
        subkind: result.terminal.actor,
        safeCode: null,
        retryable: null,
        partialMarkdown,
        contentIncomplete: true,
        actualProfile,
      };
    case "timeout":
      return {
        kind: "timeout",
        subkind: result.terminal.basis,
        safeCode: null,
        retryable: null,
        partialMarkdown,
        contentIncomplete: true,
        actualProfile,
      };
    case "quota-exhausted":
    case "rate-limited":
    case "auth":
      return {
        kind: result.terminal.kind,
        subkind: null,
        safeCode: result.terminal.safeCode,
        retryable: result.terminal.retryable,
        partialMarkdown,
        contentIncomplete: true,
        actualProfile,
      };
    case "crashed":
      return {
        kind: "crashed",
        subkind: null,
        safeCode: result.terminal.safeCode,
        retryable: null,
        partialMarkdown,
        contentIncomplete: true,
        actualProfile,
      };
    default:
      return assertNeverExecutionTerminal(result.terminal);
  }
}

function assertNeverExecutionTerminal(value: never): never {
  throw new Error(`Unhandled local execution terminal: ${String(value)}`);
}

function workerLaneKey(sessionId: string, role: string): string {
  return `${sessionId}\u0000${role}`;
}

function isPendingPrimaryMessage(message: LocalConsoleMessage): boolean {
  return isPendingDispatchMessage(message)
    && message.dispatchLane !== "worker"
    && message.dispatchLane !== "awaiting-team";
}

function isPendingDispatchMessage(message: LocalConsoleMessage): boolean {
  return message.speaker === "user" && message.status === "pending";
}

function projectPendingDispatch(message: LocalConsoleMessage) {
  const targetLane = message.dispatchLane ?? "primary";
  return {
    message,
    targetLane,
    targetRole: message.dispatchRole ?? null,
    waitingForTeam: targetLane === "awaiting-team",
  };
}

function hasPendingStartupControlWork(session: LocalConsoleSessionSummary): boolean {
  return session.hasPendingControlWork === true || session.runningCount > 0;
}

function isWorkerRunPlaceholder(message: LocalConsoleMessage): boolean {
  return message.sourceKind === "local-worker-run";
}

function isVisibleTimelineMessage(message: LocalConsoleMessage): boolean {
  return message.sourceKind !== "pending-removed"
    && !isPendingDispatchMessage(message)
    && !isWorkerRunPlaceholder(message);
}

function formatReferenceContentSegments(label: string, value: string, segmentSize = 12_000): string {
  const graphemes = Array.from(value);
  const segmentCount = Math.max(1, Math.ceil(graphemes.length / segmentSize));
  const sections: string[] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    sections.push([
      `${label} [${String(index + 1)}/${String(segmentCount)}]`,
      graphemes.slice(index * segmentSize, (index + 1) * segmentSize).join(""),
    ].join("\n"));
  }
  return sections.join("\n");
}

function assertTextFragments(fragments: readonly LocalConsoleTextFragment[]): void {
  const ids = new Set<string>();
  for (const fragment of fragments) {
    if (
      fragment.id.trim() === ""
      || fragment.label.trim() === ""
      || fragment.text.trim() === ""
    ) {
      throw new Error("Text fragments require non-empty id, label, and text");
    }
    if (ids.has(fragment.id)) {
      throw new Error("Text fragment ids must be unique");
    }
    ids.add(fragment.id);
  }
}

function requireAgentFilePath(agent: LocalConsoleAgentFile): string {
  if (agent.path === undefined) {
    throw new Error(`Agent snapshot has no content: ${agent.name}`);
  }
  return agent.path;
}

async function directoryAvailable(folderPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(folderPath);
    if (!stat.isDirectory()) {
      return false;
    }
    await fs.access(folderPath);
    return true;
  } catch {
    return false;
  }
}

async function fileAvailable(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function collectLocalCeoLedgerTaskIds(finalText: string): string[] {
  const jsonText = stripLocalCeoJson(finalText);
  if (jsonText === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!isPlainObject(parsed)) {
    return [];
  }
  const issues = parsed["issues"];
  if (!Array.isArray(issues)) {
    return [];
  }
  return issues
    .map((issue) => (isPlainObject(issue) && typeof issue["ledgerTaskId"] === "string" ? issue["ledgerTaskId"] : null))
    .filter((value): value is string => value !== null && value.trim() !== "");
}

function stripLocalCeoJson(finalText: string): string | null {
  const marker = `<!-- moebius:stage=${CEO_ORCHESTRATION_STAGE} -->`;
  const withoutMarker = finalText.includes(marker) ? finalText.slice(0, finalText.lastIndexOf(marker)).trim() : finalText.trim();
  const fenced = withoutMarker.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u);
  return (fenced?.[1] ?? withoutMarker).trim();
}

function localOrchestrationKey(input: {
  parentSessionId: string;
  workflowId: string;
  ledgerTaskId: string;
}): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${input.parentSessionId}|${input.workflowId}|${input.ledgerTaskId}`)
    .digest("hex")
    .slice(0, 32);
  return `moebius-local-orchestration-key:${digest}`;
}

function localChildSessionId(parentSessionId: string, ledgerTaskId: string): string {
  const digest = crypto.createHash("sha256").update(`${parentSessionId}|${ledgerTaskId}`).digest("hex").slice(0, 12);
  return `local:child:${slugForLocalSessionId(ledgerTaskId)}:${digest}`;
}

function slugForLocalSessionId(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return slug === "" ? "task" : slug.slice(0, 40);
}

function renderLocalChildSessionInitialBody(input: {
  parentSessionId: string;
  workflowId: string;
  group: CeoOrchestrationGroup;
  descriptor: CeoChildIssueDescriptor;
  orchestrationKey: string;
}): string {
  const taskChecks = input.descriptor.acceptanceStatements.map((statement, index) => `${String(index + 1)}. ${statement}`).join("\n");
  const dependencies =
    input.descriptor.dependencies.length === 0
      ? "- none"
      : input.descriptor.dependencies.map((dependency) => `- ${dependency}`).join("\n");

  return `${input.descriptor.description.trimEnd()}

Parent session: ${input.parentSessionId}
Ledger task id: ${input.descriptor.ledgerTaskId}
Workflow id: ${input.workflowId}
Quality baseline: ${input.descriptor.qualityBaseline}

Dependencies:
${dependencies}
${taskChecks === "" ? "" : `\n任务检查参考:\n${taskChecks}\n`}

Initial handoff:
@${input.descriptor.initialRole} 请按任务描述、质量基准和现有上下文推进。

Conflict group: ${input.group.id}
Conflict reason: ${input.group.reason}

Provenance:
${input.descriptor.provenance}

<!-- ${input.orchestrationKey} -->`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
