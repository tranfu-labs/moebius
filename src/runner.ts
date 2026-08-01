import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVE_ISSUE_NO_CHANGE_LIMIT,
  ACTIVE_ISSUE_POLL_INTERVAL_MS,
  AGENT_CONTEXTS_STATE_PATH,
  AGENTS_DIR,
  CODEX_DRIVER_POOL_MAX_CONCURRENT,
  CODEX_RUN_IDLE_TIMEOUT_MS,
  CODEX_RUN_MAX_DURATION_MS,
  CEO_ORCHESTRATION_ACTION_TIMEOUT_MS,
  CONFIG_LOG_FIELDS,
  FAILURE_RETRY_LIMIT,
  IDLE_REPOSITORY_SCAN_INTERVAL_MS,
  ISSUE_DISCOVERY_LIMIT,
  MAX_ACTIVE_ISSUES,
  RUNNING_AGENT_INTERRUPT_POLL_INTERVAL_MS,
  TICK_INTERVAL_MS,
  TMP_ROOT,
  WATCH_REPOSITORIES,
  WORKDIR_ROOT,
} from "./config.js";
import {
  formatConversationInterrupt,
  resolveConversationInterrupt,
  startPollingConversationInterruptMonitor,
  type ConversationInterrupt,
  type PollingConversationInterruptMonitor,
} from "./conversation-interrupt.js";
import { parseAgentManifest } from "./agent-manifest.js";
import { loadAgentContextStateStore } from "./agent-context-state.js";
import { runAgentPreScript } from "./agent-prescripts/index.js";
import { runIssueWorktreeCapability } from "./agent-prescripts/issue-worktree.js";
import { formatCeoScriptsForPrompt, loadCeoScripts, type CeoScript } from "./ceo-scripts.js";
import {
  buildCeoOrchestrationKey,
  buildCeoRoundtableCompletionKey,
  buildCeoRoundtableKey,
  buildGoalIntakeProposalKey,
  ensureInProgressStage,
  extractCeoRoundtableCompletionKey,
  extractGoalIntakeProposalKey,
  parseCeoOrchestrationOutput,
  renderCeoChildIssueBody,
  renderCeoRoundtableChildIssueBody,
  renderCeoRoundtableParentSummaryBody,
  renderCeoRoundtableRouteBody,
  renderGoalIntakeProposalBody,
  type CeoChildIssueDescriptor,
  type CeoOrchestrationGroup,
  type CeoRoundtableContribution,
  type GoalIntakeTaskDescriptor,
  type ParsedCeoOrchestration,
} from "./ceo-orchestration.js";
import { resolveCeoLedgerPromptContext } from "./agent-prescripts/ceo-ledger-context.js";
import {
  buildRolePromptPlan,
  buildTimeline,
  countMessages,
  formatAgentComment,
  resolveNextRoleThreadState,
  type TimelineMessage,
} from "./conversation.js";
import {
  executionTimeoutKind,
  isInterruptedCodexRunResult,
  run as runCodex,
  type CodexRunResult,
} from "./codex.js";
import {
  resolveCodexRollout,
  type CodexRolloutResolution,
} from "./codex-rollout.js";
import { createDriverPool, type DriverPool } from "./driver-pool.js";
import {
  createIssueDispatcher,
  foldIssueProcessingJobResult,
  issueKeyForJob,
  type IssueDispatcher,
  type IssueProcessingJob,
  type IssueProcessingJobResult,
} from "./issue-dispatcher.js";
import { runIntakeScan } from "./scanner.js";
import { createStatePersister, type StatePersister } from "./state-persister.js";
import { closeSqliteStateWorkers } from "./sqlite-state.js";
import {
  appendCeoReviewedMetadata,
  CEO_CORRECTED_METADATA,
  formatCeoComment,
  formatExternalCommentRoute,
  type FormatCeoResult,
} from "./format-ceo.js";
import {
  addReaction,
  createIssue,
  fetchIssueState,
  fetchIssueWithComments,
  findIssueByOrchestrationKey,
  isGitHubIssueNotFoundError,
  listOpenIssueSummaries,
  postComment,
  publishReleaseArtifacts,
  type CreatedIssue,
  type GitHubIssue,
} from "./github.js";
import {
  loadGoalLedgerState,
  saveGoalLedgerEntry,
} from "./goal-ledger-state.js";
import {
  applyGoalIntakeProposal,
  confirmGoalIntakeProposal,
  resolveGoalIntakeProposal,
  GoalLedgerState,
} from "./goal-ledger.js";
import { appendMediaManifest, extractIssueMediaReferences, type MediaPromptEntry } from "./issue-media.js";
import {
  discoverOutputArtifacts,
  formatArtifactPublishingFailure,
  formatMediaPreparationFailure,
  formatPublishedArtifactsMarkdown,
  type MediaPreparationFailure,
  prepareIssueMedia,
} from "./media-assets.js";
import {
  failedIssueProcessingOutcome,
  getDueActiveIssueSources,
  isFailedIssueProcessingOutcome,
  type GitHubResponseIntakeState,
  type IntakeIssueState,
  type IssueProcessingOutcome,
  type IssueSummary,
} from "./github-response-intake.js";
import { loadGitHubResponseIntakeState, saveGitHubResponseIntakeState } from "./github-intake-state.js";
import { makeIssueSource, type IssueSource, type RepositoryRef } from "./issue-source.js";
import { log } from "./log.js";
import { startLocalConsoleServer } from "./local-console/start.js";
import { resolveRuntimeMode, type RuntimeMode } from "./runtime-mode.js";
import { maybeProcessIntegrationAcceptancePrePass } from "./runner/acceptance-prepass.js";
import { addCodexExecutionReaction, resolveCodexExecutionReactionTarget } from "./runner/codex-execution-reaction.js";
import { maybeRecoverRoundtableNoHandoff, maybeRouteExternalNoMentionComment } from "./runner/external-route.js";
import {
  findTaskChildIssueRefByOrchestrationKey,
  findTaskChildIssueRefByRoundtableKey,
  buildCeoIssueContext,
  formatBypassedAgentComment,
  formatCeoOrchestrationFailureBody,
  formatError,
  formatFailureReason,
  formatGuardedAgentComment,
  issueContainsHiddenKey,
  issueFromReference,
  issueUrl,
  isTaskRecord,
  nextRoundtableParticipant,
  requireRoundtableIssueContext,
  roundtableParticipantMessageIndexes,
  saveTaskChildIssueRef,
  saveTaskRoundtableChildIssueRef,
  truncateForComment,
  withTimeout,
  type CeoSpawnCompletedItem,
  type RoundtableIssueContext,
} from "./runner/runtime-contracts.js";
import {
  getRoleThreadState,
  loadRoleThreadStateStore,
  saveRoleThreadStateEntry,
} from "./state.js";
import { parseTrailingStageMarker } from "./stages.js";
import { resolveTrigger } from "./triggers/index.js";

let runDirSequence = 0;

const DEFAULT_RUN_MANIFEST_PATH = path.join(".state", "run-manifests.jsonl");

export interface AgentFile {
  name: string;
  path: string;
}

export interface ProcessIssueSourceDependencies {
  runIssueWorktreeCapability: typeof runIssueWorktreeCapability;
  runAgentPreScript: typeof runAgentPreScript;
  runCodex: typeof runCodex;
  resolveCodexThread: (threadId: string) => Promise<CodexRolloutResolution>;
  addReaction: typeof addReaction;
  createIssue: typeof createIssue;
  fetchIssueState: typeof fetchIssueState;
  fetchIssueWithComments: typeof fetchIssueWithComments;
  findIssueByOrchestrationKey: typeof findIssueByOrchestrationKey;
  postComment: typeof postComment;
  prepareIssueMedia: typeof prepareIssueMedia;
  discoverOutputArtifacts: typeof discoverOutputArtifacts;
  publishArtifacts: typeof publishReleaseArtifacts;
  loadRoleThreadStateStore: typeof loadRoleThreadStateStore;
  saveRoleThreadStateEntry: typeof saveRoleThreadStateEntry;
  loadCeoScripts: typeof loadCeoScripts;
  loadGoalLedgerState: typeof loadGoalLedgerState;
  saveGoalLedgerEntry: typeof saveGoalLedgerEntry;
  formatCeoComment: typeof formatCeoComment;
  formatExternalCommentRoute: typeof formatExternalCommentRoute;
  writeRunManifest: typeof writeRunManifest;
}

const DEFAULT_PROCESS_ISSUE_SOURCE_DEPENDENCIES: ProcessIssueSourceDependencies = {
  runIssueWorktreeCapability,
  runAgentPreScript,
  runCodex,
  resolveCodexThread: resolveCodexRollout,
  addReaction,
  createIssue,
  fetchIssueState,
  fetchIssueWithComments,
  findIssueByOrchestrationKey,
  postComment,
  prepareIssueMedia,
  discoverOutputArtifacts,
  publishArtifacts: publishReleaseArtifacts,
  loadRoleThreadStateStore,
  saveRoleThreadStateEntry,
  loadCeoScripts,
  loadGoalLedgerState,
  saveGoalLedgerEntry,
  formatCeoComment,
  formatExternalCommentRoute,
  writeRunManifest,
};

export type RunManifestStage = "plan-written" | "code-verified" | "in-progress" | "unknown";

export interface RunManifestRecord {
  issue: {
    owner: string;
    repo: string;
    number: number;
  };
  role: string;
  stage: RunManifestStage;
  artifacts: Array<{
    path: string;
    publishedUrl: string | null;
  }>;
  startedAt: string;
  completedAt: string;
}

export interface RunnerDependencies {
  watchRepositories: readonly RepositoryRef[];
  driverPool: DriverPool;
  listAgentFiles: typeof listAgentFiles;
  listOpenIssueSummaries: typeof listOpenIssueSummaries;
  fetchIssueWithComments: typeof fetchIssueWithComments;
  processIssueSource: typeof processIssueSource;
  postComment: typeof postComment;
  saveGitHubResponseIntakeState: typeof saveGitHubResponseIntakeState;
}

export function createDefaultCodexDriverPool(): DriverPool {
  return createDriverPool({ maxConcurrent: CODEX_DRIVER_POOL_MAX_CONCURRENT });
}

export function createDefaultRunnerDependencies(): RunnerDependencies {
  return {
    watchRepositories: WATCH_REPOSITORIES,
    driverPool: createDefaultCodexDriverPool(),
    listAgentFiles,
    listOpenIssueSummaries,
    fetchIssueWithComments,
    processIssueSource,
    postComment,
    saveGitHubResponseIntakeState,
  };
}

export async function writeRunManifest(input: {
  record: RunManifestRecord;
  runDir: string;
  manifestPath?: string;
}): Promise<void> {
  const manifestPath = input.manifestPath ?? DEFAULT_RUN_MANIFEST_PATH;
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.appendFile(manifestPath, `${JSON.stringify(input.record)}\n`, "utf8");

  try {
    await fs.mkdir(input.runDir, { recursive: true });
    await fs.writeFile(path.join(input.runDir, "run-manifest.json"), `${JSON.stringify(input.record, null, 2)}\n`, "utf8");
  } catch {
    // The runDir copy is only for debugging; the JSONL state file above is the contract source.
  }
}

export interface Runner {
  heartbeat(now?: Date): Promise<void>;
  dispatcher: IssueDispatcher;
  persister: StatePersister;
}

export function createRunner(input: {
  initialState: GitHubResponseIntakeState;
  dependencies?: RunnerDependencies;
}): Runner {
  const dependencies = input.dependencies ?? createDefaultRunnerDependencies();
  const persister = createStatePersister({
    initialState: input.initialState,
    save: dependencies.saveGitHubResponseIntakeState,
  });

  let agentFiles: AgentFile[] = [];
  const dispatcher = createIssueDispatcher({
    driverPool: dependencies.driverPool,
    persister,
    runJob: async (job) => {
      const result =
        job.kind === "active"
          ? await processActiveIssueJob({
              job,
              agentFiles,
              fetchIssueWithComments: dependencies.fetchIssueWithComments,
              processIssueSource: dependencies.processIssueSource,
            })
          : await processChangedIssueJob({
              job,
              agentFiles,
              fetchIssueWithComments: dependencies.fetchIssueWithComments,
              processIssueSource: dependencies.processIssueSource,
            });

      return resolveDeadLetterForFailedResult({
        state: persister.state(),
        result,
        failureRetryLimit: FAILURE_RETRY_LIMIT,
        postComment: dependencies.postComment,
      });
    },
    timing: {
      activeIssuePollIntervalMs: ACTIVE_ISSUE_POLL_INTERVAL_MS,
      activeIssueNoChangeLimit: ACTIVE_ISSUE_NO_CHANGE_LIMIT,
    },
    policy: {
      repositories: dependencies.watchRepositories,
      maxActiveIssues: MAX_ACTIVE_ISSUES,
    },
  });

  let scanning = false;
  const heartbeat = async (now = new Date()): Promise<void> => {
    if (scanning) {
      log({ event: "skip-overlap" });
      return;
    }

    scanning = true;
    try {
      agentFiles = await dependencies.listAgentFiles();
      const changedIssues = await runIntakeScan({
        repositories: dependencies.watchRepositories,
        getState: persister.state,
        applyState: persister.update,
        now,
        listOpenIssueSummaries: dependencies.listOpenIssueSummaries,
        config: {
          idleRepositoryScanIntervalMs: IDLE_REPOSITORY_SCAN_INTERVAL_MS,
          issueDiscoveryLimit: ISSUE_DISCOVERY_LIMIT,
        },
      });

      const state = persister.state();
      const jobs: IssueProcessingJob[] = [
        ...changedIssues.map((summary) => {
          const issueState = state.issues[makeIssueSource(summary).issueKey];
          return { kind: "changed" as const, summary, previousIssueState: issueState };
        }),
        ...getDueActiveIssueSources({
          repositories: dependencies.watchRepositories,
          state,
          now,
        }).map((source) => {
          const issueState = state.issues[source.issueKey];
          return {
            kind: "active" as const,
            source,
            previousUpdatedAt: issueState?.updatedAt ?? new Date(0).toISOString(),
            previousActiveNoChangeCount: issueState?.activeNoChangeCount ?? 0,
            previousIssueState: issueState,
          };
        }),
      ];

      for (const job of dedupeIssueProcessingJobs(jobs)) {
        dispatcher.dispatch(job);
      }
    } catch (error) {
      log({ event: "cycle-error", error: formatError(error) });
    } finally {
      scanning = false;
    }
  };

  return { heartbeat, dispatcher, persister };
}

function dedupeIssueProcessingJobs(jobs: IssueProcessingJob[]): IssueProcessingJob[] {
  const seen = new Set<string>();
  const result: IssueProcessingJob[] = [];
  for (const job of jobs) {
    const issueKey = issueKeyForJob(job);
    if (seen.has(issueKey)) {
      log({ event: "issue-job-deduped", issueKey });
      continue;
    }

    seen.add(issueKey);
    result.push(job);
  }

  return result;
}

async function processActiveIssueJob(input: {
  job: Extract<IssueProcessingJob, { kind: "active" }>;
  agentFiles: AgentFile[];
  fetchIssueWithComments: typeof fetchIssueWithComments;
  processIssueSource: typeof processIssueSource;
}): Promise<IssueProcessingJobResult> {
  try {
    const issue = await input.fetchIssueWithComments(input.job.source);
    if (issue.state === "CLOSED") {
      log({ event: "skip", reason: "issue-closed", issueKey: input.job.source.issueKey });
      return {
        kind: "processed",
        summary: issueSummaryFromSource(input.job.source, issue.updatedAt),
        outcome: "issue-closed",
      };
    }

    if (issue.updatedAt === input.job.previousUpdatedAt) {
      log({
        event: "active-issue-unchanged",
        issueKey: input.job.source.issueKey,
        activeNoChangeCount: input.job.previousActiveNoChangeCount + 1,
      });
      return {
        kind: "active-unchanged",
        source: input.job.source,
      };
    }

    const outcome = await input.processIssueSource({
      source: input.job.source,
      issue,
      agentFiles: input.agentFiles,
      intakeIssueState: input.job.previousIssueState,
    });

    return {
      kind: "processed",
      summary: issueSummaryFromSource(input.job.source, issue.updatedAt),
      outcome,
    };
  } catch (error) {
    if (isGitHubIssueNotFoundError(error)) {
      log({ event: "skip", reason: "issue-not-found", issueKey: error.issueKey, detail: error.detail.trim() });
      return {
        kind: "processed",
        summary: issueSummaryFromSource(input.job.source, input.job.previousUpdatedAt),
        outcome: "issue-not-found",
      };
    }

    const reason = formatFailureReason(error);
    log({ event: "active-issue-fetch-failed", issueKey: input.job.source.issueKey, outcome: "failed", error: formatError(error) });
    return {
      kind: "processed",
      summary: issueSummaryFromSource(input.job.source, input.job.previousUpdatedAt),
      outcome: failedIssueProcessingOutcome({ reason }),
    };
  }
}

async function processChangedIssueJob(input: {
  job: Extract<IssueProcessingJob, { kind: "changed" }>;
  agentFiles: AgentFile[];
  fetchIssueWithComments: typeof fetchIssueWithComments;
  processIssueSource: typeof processIssueSource;
}): Promise<IssueProcessingJobResult> {
  const source = makeIssueSource(input.job.summary);

  try {
    const issue = await input.fetchIssueWithComments(source);
    if (issue.state === "CLOSED") {
      log({ event: "skip", reason: "issue-closed", issueKey: source.issueKey });
      return {
        kind: "processed",
        summary: issueSummaryFromSource(source, issue.updatedAt),
        outcome: "issue-closed",
      };
    }

    const outcome = await input.processIssueSource({
      source,
      issue,
      agentFiles: input.agentFiles,
      intakeIssueState: input.job.previousIssueState,
    });

    return {
      kind: "processed",
      summary: issueSummaryFromSource(source, issue.updatedAt),
      outcome,
    };
  } catch (error) {
    if (isGitHubIssueNotFoundError(error)) {
      log({ event: "skip", reason: "issue-not-found", issueKey: error.issueKey, detail: error.detail.trim() });
      return {
        kind: "processed",
        summary: input.job.summary,
        outcome: "issue-not-found",
      };
    }

    const reason = formatFailureReason(error);
    log({ event: "issue-fetch-failed", issueKey: source.issueKey, outcome: "failed", error: formatError(error) });
    return {
      kind: "processed",
      summary: input.job.summary,
      outcome: failedIssueProcessingOutcome({ reason }),
    };
  }
}

export async function pollActiveIssue(input: {
  state: GitHubResponseIntakeState;
  source: IssueSource;
  agentFiles: AgentFile[];
  now: Date;
}, dependencies: {
  fetchIssueWithComments: typeof fetchIssueWithComments;
  processIssueSource: typeof processIssueSource;
} = {
  fetchIssueWithComments,
  processIssueSource,
}): Promise<GitHubResponseIntakeState> {
  const issueState = input.state.issues[input.source.issueKey];
  if (issueState === undefined || issueState.mode !== "active") {
    return input.state;
  }

  const result = await processActiveIssueJob({
    job: {
      kind: "active",
      source: input.source,
      previousUpdatedAt: issueState.updatedAt,
      previousActiveNoChangeCount: issueState.activeNoChangeCount,
      previousIssueState: issueState,
    },
    agentFiles: input.agentFiles,
    fetchIssueWithComments: dependencies.fetchIssueWithComments,
    processIssueSource: dependencies.processIssueSource,
  });

  return foldIssueProcessingJobResult({
    state: input.state,
    result,
    now: input.now,
    timing: {
      activeIssuePollIntervalMs: ACTIVE_ISSUE_POLL_INTERVAL_MS,
      activeIssueNoChangeLimit: ACTIVE_ISSUE_NO_CHANGE_LIMIT,
    },
  });
}

async function resolveDeadLetterForFailedResult(input: {
  state: GitHubResponseIntakeState;
  result: IssueProcessingJobResult;
  failureRetryLimit: number;
  postComment: typeof postComment;
}): Promise<IssueProcessingJobResult> {
  if (input.result.kind !== "processed" || !isFailedIssueProcessingOutcome(input.result.outcome)) {
    return input.result;
  }

  const source = makeIssueSource(input.result.summary);
  const previousFailureCount = input.state.issues[source.issueKey]?.failureCount ?? 0;
  const failureCount = previousFailureCount + 1;

  if (failureCount < input.failureRetryLimit) {
    log({
      event: "issue-retry-scheduled",
      issueKey: source.issueKey,
      failureCount,
      reason: input.result.outcome.reason,
    });
    return input.result;
  }

  try {
    await input.postComment(
      source,
      formatDeadLetterComment({
        agent: input.result.outcome.agent ?? "unknown",
        reason: input.result.outcome.reason,
        failureCount,
      }),
    );
    log({
      event: "dead-letter-posted",
      issueKey: source.issueKey,
      failureCount,
      reason: input.result.outcome.reason,
    });
    return {
      ...input.result,
      outcome: "dead-lettered",
    };
  } catch (error) {
    log({
      event: "dead-letter-post-failed",
      issueKey: source.issueKey,
      failureCount,
      reason: input.result.outcome.reason,
      error: formatError(error),
    });
    return input.result;
  }
}

export async function processIssueSource(
  input: {
    source: IssueSource;
    issue: GitHubIssue;
    agentFiles: AgentFile[];
    intakeIssueState?: IntakeIssueState;
  },
  dependencies = DEFAULT_PROCESS_ISSUE_SOURCE_DEPENDENCIES,
): Promise<IssueProcessingOutcome> {
  let selectedAgentName: string | null = null;
  let published = false;

  const postVisibleComment = async (body: string): Promise<void> => {
    await dependencies.postComment(input.source, body);
    published = true;
  };

  try {
    const count = countMessages(input.issue.comments.length);
    const agentFiles = input.agentFiles;
    const agentNames = agentFiles.map((agent) => agent.name);
    const timeline = buildTimeline(input.issue.body, input.issue.comments, agentNames);
    const acceptancePrePassOutcome = await maybeProcessIntegrationAcceptancePrePass({
      source: input.source,
      issue: input.issue,
      timeline,
      agentNames,
      count,
      postVisibleComment,
      dependencies,
    });
    if (acceptancePrePassOutcome !== null) {
      return acceptancePrePassOutcome;
    }

    const roundtableRecoveryOutcome = await maybeRecoverRoundtableNoHandoff({
      source: input.source,
      issue: input.issue,
      timeline,
      intakeIssueState: input.intakeIssueState,
      postVisibleComment,
    });
    if (roundtableRecoveryOutcome !== null) {
      return roundtableRecoveryOutcome;
    }

    const trigger = resolveTrigger({ timeline, availableAgentNames: agentNames });

    if (trigger.kind === "skip") {
      const fallbackRouteOutcome = await maybeRouteExternalNoMentionComment({
        source: input.source,
        issue: input.issue,
        timeline,
        agentNames,
        intakeIssueState: input.intakeIssueState,
        count,
        makeRunDir,
        postVisibleComment,
        dependencies,
      });
      if (fallbackRouteOutcome !== null) {
        return fallbackRouteOutcome;
      }

      log({ event: "skip", count, reason: trigger.reason, issueKey: input.source.issueKey });
      return "no-trigger";
    }

    const selectedAgent = agentFiles.find((agent) => agent.name === trigger.role);
    if (selectedAgent === undefined) {
      log({ event: "skip", count, reason: "selected-agent-missing", agent: trigger.role });
      return "no-trigger";
    }
    selectedAgentName = selectedAgent.name;

    const runDir = makeRunDir(count);
    log({ event: "trigger", count, runDir, agent: selectedAgent.name, issueKey: input.source.issueKey });

    const agentMarkdown = await fs.readFile(selectedAgent.path, "utf8");
    const agentManifest = parseAgentManifest(agentMarkdown);
    const stateStore = await dependencies.loadRoleThreadStateStore();
    const existingState = getRoleThreadState(stateStore, input.source.issueKey, selectedAgent.name);
    const plan = buildRolePromptPlan({
      role: selectedAgent.name,
      agentMarkdown: agentManifest.body,
      timeline,
      state: existingState,
    });

    if (plan.kind === "skip") {
      log({ event: "skip", count, reason: plan.reason, agent: selectedAgent.name, issueKey: input.source.issueKey });
      return "no-trigger";
    }

    let codexCwd: string | undefined;
    const promptContexts: string[] = [];
    if (agentManifest.workspaceAccess !== null) {
      const workspaceResult = await dependencies.runIssueWorktreeCapability({
        role: selectedAgent.name,
        workspaceAccess: agentManifest.workspaceAccess,
        latestIndex: plan.latestIndex,
        issueSource: input.source,
        workdirRoot: WORKDIR_ROOT,
        contextStatePath: AGENT_CONTEXTS_STATE_PATH,
      });

      if (!workspaceResult.ok) {
        log({
          event: "agent-workspace-failed",
          count,
          runDir,
          agent: selectedAgent.name,
          workspaceAccess: agentManifest.workspaceAccess,
          reason: workspaceResult.reason,
          issueKey: input.source.issueKey,
        });
        return failedIssueProcessingOutcome({ reason: workspaceResult.reason, agent: selectedAgent.name });
      }

      codexCwd = workspaceResult.codexCwd;
      if (workspaceResult.promptContext !== undefined) {
        promptContexts.push(workspaceResult.promptContext);
      }
      log({
        event: "agent-workspace-completed",
        count,
        runDir,
        agent: selectedAgent.name,
        workspaceAccess: agentManifest.workspaceAccess,
        codexCwd,
        issueKey: input.source.issueKey,
      });
    }

    if (agentManifest.preScript !== null) {
      const preScriptResult = await dependencies.runAgentPreScript({
        role: selectedAgent.name,
        preScript: agentManifest.preScript,
        latestIndex: plan.latestIndex,
        issueSource: input.source,
        workdirRoot: WORKDIR_ROOT,
        contextStatePath: AGENT_CONTEXTS_STATE_PATH,
      });

      if (!preScriptResult.ok) {
        log({
          event: "agent-prescript-failed",
          count,
          runDir,
          agent: selectedAgent.name,
          preScript: agentManifest.preScript,
          reason: preScriptResult.reason,
          issueKey: input.source.issueKey,
        });
        if (selectedAgent.name === "ceo" && preScriptResult.visibleFailureBody !== undefined) {
          await postVisibleComment(
            formatBypassedAgentComment(
              selectedAgent.name,
              preScriptResult.visibleFailureBody,
              "agent-prescript-failed",
            ),
          );
          return "triggered-success";
        }

        return failedIssueProcessingOutcome({ reason: preScriptResult.reason, agent: selectedAgent.name });
      }

      if (preScriptResult.codexCwd !== undefined && codexCwd !== undefined && preScriptResult.codexCwd !== codexCwd) {
        const reason = `workspace-prescript-cwd-conflict:${codexCwd}:${preScriptResult.codexCwd}`;
        log({
          event: "agent-prescript-failed",
          count,
          runDir,
          agent: selectedAgent.name,
          preScript: agentManifest.preScript,
          reason,
          issueKey: input.source.issueKey,
        });
        return failedIssueProcessingOutcome({ reason, agent: selectedAgent.name });
      }

      codexCwd = preScriptResult.codexCwd ?? codexCwd;
      if (preScriptResult.promptContext !== undefined) {
        promptContexts.push(preScriptResult.promptContext);
      }
      log({
        event: "agent-prescript-completed",
        count,
        runDir,
        agent: selectedAgent.name,
        preScript: agentManifest.preScript,
        codexCwd,
        issueKey: input.source.issueKey,
      });
    }
    const agentPromptContext = promptContexts.length === 0 ? undefined : promptContexts.join("\n\n");
    const roleContext = buildRoleThreadContextProof({
      role: selectedAgent.name,
      agentMarkdown: agentManifest.body,
      cwd: codexCwd,
    });
    if (existingState !== null && !roleThreadContextCompatible(existingState, roleContext)) {
      return failedIssueProcessingOutcome({
        reason: "resume-unavailable:context-mismatch",
        agent: selectedAgent.name,
      });
    }
    if (plan.mode === "resume") {
      let resolution: CodexRolloutResolution;
      try {
        resolution = await dependencies.resolveCodexThread(plan.threadId);
      } catch (error) {
        return failedIssueProcessingOutcome({
          reason: `resume-unavailable:preflight-failed:${formatError(error)}`,
          agent: selectedAgent.name,
        });
      }
      if (resolution.status === "unavailable") {
        log({
          event: "codex-resume-unavailable",
          count,
          runDir,
          agent: selectedAgent.name,
          issueKey: input.source.issueKey,
          threadId: plan.threadId,
          reason: resolution.reason,
        });
        return failedIssueProcessingOutcome({
          reason: `resume-unavailable:${resolution.reason}`,
          agent: selectedAgent.name,
        });
      }
    }

    const initialMedia = await prepareMediaForPrompt({
      messages: plan.mode === "resume" ? plan.deltaMessages : timeline,
      runDir,
      count,
      agent: selectedAgent.name,
      issueKey: input.source.issueKey,
      dependencies,
    });
    if (!initialMedia.ok) {
      await postVisibleComment(
        formatBypassedAgentComment(
          selectedAgent.name,
          formatMediaPreparationFailure(initialMedia.failures),
          "media-preparation-failed",
        ),
      );
      return "triggered-success";
    }

    const interruptController = new AbortController();
    let currentThreadId = plan.mode === "resume" ? plan.threadId : null;
    let threadStartedObserved = false;
    let threadStatePersisted = false;
    const finalRunDir = runDir;
    let finalCodexStartedAtMs = Date.now();
    await addCodexExecutionReaction({
      reaction: resolveCodexExecutionReactionTarget({
        source: input.source,
        issue: input.issue,
        latestIndex: plan.latestIndex,
      }),
      agent: selectedAgent.name,
      count,
      addReaction: dependencies.addReaction,
    });

    const interruptMonitor = startAgentRunInterruptMonitor({
      source: input.source,
      agent: selectedAgent.name,
      baselineMessageCount: count,
      controller: interruptController,
      fetchIssueWithComments: dependencies.fetchIssueWithComments,
    });

    // 看门狗已下沉到 codex.run() 内部（空闲 + 总时长硬上限，每次 run 独立计时，
    // 含有限时间 settle 保障）；runner 只按结构化 terminal 分流日志并把超时折叠为 failed。
    const codexRunTimeouts = {
      idleTimeoutMs: CODEX_RUN_IDLE_TIMEOUT_MS,
      maxDurationMs: CODEX_RUN_MAX_DURATION_MS,
    };

    const resolveCodexTimeoutOutcome = (
      failedResult: Extract<CodexRunResult, { ok: false }>,
    ): IssueProcessingOutcome | null => {
      const timeoutKind = executionTimeoutKind(failedResult);
      if (timeoutKind === null) {
        return null;
      }

      log({
        event: timeoutKind === "idle" ? "codex-idle-timeout" : "codex-watchdog-timeout",
        count,
        runDir: failedResult.runDir,
        agent: selectedAgent.name,
        issueKey: input.source.issueKey,
        timeoutMs: timeoutKind === "idle" ? CODEX_RUN_IDLE_TIMEOUT_MS : CODEX_RUN_MAX_DURATION_MS,
      });
      return failedIssueProcessingOutcome({
        reason: failedResult.reason,
        agent: selectedAgent.name,
      });
    };

    const resolveInterruptedOutcome = (interruptedResult: { runDir: string; reason: string }): IssueProcessingOutcome => {
      log({
        event: "codex-interrupted",
        count,
        runDir: interruptedResult.runDir,
        reason: interruptedResult.reason,
        agent: selectedAgent.name,
        issueKey: input.source.issueKey,
      });
      return "interrupted";
    };

    let result: Awaited<ReturnType<ProcessIssueSourceDependencies["runCodex"]>>;
    try {
      finalCodexStartedAtMs = Date.now();
      log({
        event: "codex-invocation",
        count,
        runDir,
        agent: selectedAgent.name,
        issueKey: input.source.issueKey,
        mode: plan.mode,
        threadId: plan.mode === "resume" ? plan.threadId : null,
      });
      result = await dependencies.runCodex({
        prompt: appendMediaManifest(appendPromptContext(plan.prompt, agentPromptContext), initialMedia.prepared),
        runDir,
        cwd: codexCwd,
        signal: interruptController.signal,
        mode: plan.mode === "resume" ? { kind: "resume", threadId: plan.threadId } : { kind: "full" },
        imagePaths: initialMedia.imagePaths,
        ...codexRunTimeouts,
        onThreadStarted: async (threadId) => {
          if (plan.mode === "resume" && threadId !== plan.threadId) {
            throw new Error(`resume-unavailable:thread-id-mismatch:${threadId}`);
          }
          threadStartedObserved = true;
          currentThreadId = threadId;
          await dependencies.saveRoleThreadStateEntry(
            input.source.issueKey,
            selectedAgent.name,
            {
              threadId,
              lastSeenIndex: existingState?.lastSeenIndex ?? -1,
              ...roleContext,
            },
          );
          threadStatePersisted = true;
        },
      });

      if (
        !result.ok
        && threadStartedObserved
        && !threadStatePersisted
        && currentThreadId !== null
      ) {
        await dependencies.saveRoleThreadStateEntry(
          input.source.issueKey,
          selectedAgent.name,
          {
            threadId: currentThreadId,
            lastSeenIndex: existingState?.lastSeenIndex ?? -1,
            ...roleContext,
          },
        );
        threadStatePersisted = true;
      }

      if (isInterruptedCodexRunResult(result)) {
        return resolveInterruptedOutcome(result);
      }

      // 超时（空闲 / 硬上限）直接判 failed 进重试链路，不落入 resume fallback：
      // 卡死不是 resume 特有的失败，全量重跑大概率复现，交给重试预算处理。
      if (!result.ok) {
        const timeoutOutcome = resolveCodexTimeoutOutcome(result);
        if (timeoutOutcome !== null) {
          return timeoutOutcome;
        }
      }

      if (!result.ok && plan.mode === "resume") {
        log({
          event: "codex-resume-failed",
          count,
          runDir: result.runDir,
          reason: result.reason,
          agent: selectedAgent.name,
          threadId: plan.threadId,
        });
        return failedIssueProcessingOutcome({
          reason: `resume-unavailable:${result.reason}`,
          agent: selectedAgent.name,
        });
      }
    } finally {
      interruptMonitor?.stop();
    }

    if (isInterruptedCodexRunResult(result)) {
      return resolveInterruptedOutcome(result);
    }

    if (!result.ok) {
      const timeoutOutcome = resolveCodexTimeoutOutcome(result);
      if (timeoutOutcome !== null) {
        return timeoutOutcome;
      }

      log({ event: "codex-failed", count, runDir: result.runDir, reason: result.reason, agent: selectedAgent.name });
      return failedIssueProcessingOutcome({ reason: result.reason, agent: selectedAgent.name });
    }
    if (plan.mode === "resume" && result.threadId !== null && result.threadId !== plan.threadId) {
      return failedIssueProcessingOutcome({
        reason: "resume-unavailable:thread-id-mismatch",
        agent: selectedAgent.name,
      });
    }
    const observedThreadId = result.threadId ?? currentThreadId;
    if (observedThreadId !== null) {
      currentThreadId = observedThreadId;
      await dependencies.saveRoleThreadStateEntry(
        input.source.issueKey,
        selectedAgent.name,
        {
          threadId: observedThreadId,
          lastSeenIndex: existingState?.lastSeenIndex ?? -1,
          ...roleContext,
        },
      );
    }

    let finalInterrupt: ConversationInterrupt | null;
    try {
      finalInterrupt = await checkAgentRunInterrupt({
        source: input.source,
        agent: selectedAgent.name,
        baselineMessageCount: count,
        fetchIssueWithComments: dependencies.fetchIssueWithComments,
      });
    } catch (error) {
      // fail-open：收尾检查只是复核有没有人插话，网络抖动不该丢弃已完成的 codex 产出。
      // 假定无新消息、照常发布；运行中监视器已覆盖绝大多数中途插话。
      log({
        event: "agent-run-interrupt-check-failopen",
        agent: selectedAgent.name,
        issueKey: input.source.issueKey,
        error: formatError(error),
      });
      finalInterrupt = null;
    }

    if (finalInterrupt !== null) {
      logAgentRunInterrupt({
        source: input.source,
        agent: selectedAgent.name,
        interrupt: finalInterrupt,
      });
      return "interrupted";
    }

    const nextState = resolveNextRoleThreadState({
      currentThreadId,
      resultThreadId: result.threadId,
      latestIndex: plan.latestIndex,
    });

    if (nextState === null) {
      log({ event: "codex-failed", count, runDir: result.runDir, reason: "no-thread-id", agent: selectedAgent.name });
      return failedIssueProcessingOutcome({ reason: "no-thread-id", agent: selectedAgent.name });
    }
    Object.assign(nextState, roleContext);

    if (selectedAgent.name === "ceo") {
      return await handleCeoAgentResult({
        source: input.source,
        issue: input.issue,
        agentNames,
        finalText: result.finalText,
        resultThreadId: nextState.threadId,
        nextState,
        runDir: finalRunDir,
        startedAtMs: finalCodexStartedAtMs,
        count,
        postVisibleComment,
        dependencies,
      });
    }

    const publishableFinalText = await buildPublishableFinalText({
      source: input.source,
      finalText: result.finalText,
      runDir: finalRunDir,
      cwd: codexCwd,
      startedAtMs: finalCodexStartedAtMs,
      count,
      agent: selectedAgent.name,
      dependencies,
    });
    if (!publishableFinalText.ok) {
      await writeRunManifestBestEffort({
        record: buildRunManifestRecord({
          source: input.source,
          role: selectedAgent.name,
          finalText: result.finalText,
          artifacts: publishableFinalText.artifacts,
          startedAtMs: finalCodexStartedAtMs,
        }),
        runDir: finalRunDir,
        count,
        agent: selectedAgent.name,
        issueKey: input.source.issueKey,
        dependencies,
      });
      await postVisibleComment(
        formatBypassedAgentComment(
          selectedAgent.name,
          formatArtifactPublishingFailure(publishableFinalText.error),
          "artifact-publishing-failed",
        ),
      );
      return "triggered-success";
    }

    const runManifestRecord = buildRunManifestRecord({
      source: input.source,
      role: selectedAgent.name,
      finalText: result.finalText,
      artifacts: publishableFinalText.artifacts,
      startedAtMs: finalCodexStartedAtMs,
    });

    const ceoResult = await dependencies.formatCeoComment({
      agent: selectedAgent.name,
      issueContext: buildCeoIssueContext(input.source, input.issue),
      latestResponse: publishableFinalText.body,
      runDir: finalRunDir,
      runCodex: dependencies.runCodex,
    });
    logCeoGuardrailResult({
      result: ceoResult,
      count,
      agent: selectedAgent.name,
      issueKey: input.source.issueKey,
    });

    if (ceoResult.action === "APPEND") {
      const originalBody = appendCeoReviewedMetadata(formatAgentComment(selectedAgent.name, publishableFinalText.body), {
        action: "append_original",
      });
      await postVisibleComment(originalBody);
      await writeRunManifestBestEffort({
        record: runManifestRecord,
        runDir: finalRunDir,
        count,
        agent: selectedAgent.name,
        issueKey: input.source.issueKey,
        dependencies,
      });
      await dependencies.saveRoleThreadStateEntry(input.source.issueKey, selectedAgent.name, nextState);

      const ceoAppendBody = `${appendCeoReviewedMetadata(formatAgentComment(ceoResult.as, ceoResult.body), {
        action: "append_ceo",
      })}\n\n${CEO_CORRECTED_METADATA}`;
      await dependencies.postComment(input.source, ceoAppendBody);
    } else {
      const postedBody = formatGuardedAgentComment(selectedAgent.name, ceoResult.body, ceoResult);
      await postVisibleComment(postedBody);
      await writeRunManifestBestEffort({
        record: runManifestRecord,
        runDir: finalRunDir,
        count,
        agent: selectedAgent.name,
        issueKey: input.source.issueKey,
        dependencies,
      });
      await dependencies.saveRoleThreadStateEntry(input.source.issueKey, selectedAgent.name, nextState);
    }

    log({
      event: "commented",
      count,
      runDir: finalRunDir,
      agent: selectedAgent.name,
      threadId: nextState.threadId,
      cachedInputTokens: result.cachedInputTokens,
      issueKey: input.source.issueKey,
    });

    return "triggered-success";
  } catch (error) {
    // 首条可见评论成功后不再 nack 重入，避免重复发帖；成功前失败仍可安全重试。
    log({ event: "process-issue-error", issueKey: input.source.issueKey, error: formatError(error) });
    if (published) {
      return "triggered-success";
    }

    return failedIssueProcessingOutcome({
      reason: formatFailureReason(error),
      agent: selectedAgentName ?? undefined,
    });
  }
}

async function handleCeoAgentResult(input: {
  source: IssueSource;
  issue: GitHubIssue;
  agentNames: string[];
  finalText: string;
  resultThreadId: string;
  nextState: NonNullable<ReturnType<typeof resolveNextRoleThreadState>>;
  runDir: string;
  startedAtMs: number;
  count: number;
  postVisibleComment: (body: string) => Promise<void>;
  dependencies: ProcessIssueSourceDependencies;
}): Promise<IssueProcessingOutcome> {
  let scripts: CeoScript[];
  let ledgerContext: ReturnType<typeof resolveCeoLedgerPromptContext>;
  try {
    scripts = await input.dependencies.loadCeoScripts({ required: true });
    const ledger = await input.dependencies.loadGoalLedgerState();
    ledgerContext = resolveCeoLedgerPromptContext({
      ledger,
      source: input.source,
      scriptsPrompt: formatCeoScriptsForPrompt(scripts),
    });
  } catch (error) {
    const failureBody = formatCeoOrchestrationFailureBody({
      reason: formatFailureReason(error),
      completed: [],
      pending: [],
    });
    try {
      await input.postVisibleComment(formatBypassedAgentComment("ceo", failureBody, "ceo-orchestration-failed"));
      return "triggered-success";
    } catch (postError) {
      throw new Error(
        `ceo-orchestration-failed:${formatFailureReason(error)}; fail-closed-comment-failed:${formatFailureReason(postError)}`,
      );
    }
  }
  const visibleTaskIds = ledgerContext.visibleTasks.map((task) => task.id);
  const parsed = parseCeoOrchestrationOutput({
    output: input.finalText,
    scripts,
    availableAgentNames: input.agentNames,
    visibleTaskIds,
  });

  if (!parsed.ok) {
    await input.postVisibleComment(
      formatBypassedAgentComment(
        "ceo",
        formatCeoOrchestrationFailureBody({
          reason: parsed.reason,
          completed: [],
          pending: [],
        }),
        "ceo-orchestration-failed",
      ),
    );
    return "triggered-success";
  }

  if (parsed.value.action === "fail") {
    await input.postVisibleComment(formatBypassedAgentComment("ceo", parsed.value.body, "ceo-orchestration-failed"));
    return "triggered-success";
  }

  if (parsed.value.action === "route") {
    await publishCeoVisibleResult({
      source: input.source,
      issue: input.issue,
      body: parsed.value.body,
      runDir: input.runDir,
      startedAtMs: input.startedAtMs,
      count: input.count,
      nextState: input.nextState,
      postVisibleComment: input.postVisibleComment,
      dependencies: input.dependencies,
    });
    return "triggered-success";
  }

  if (parsed.value.action === "goal_intake") {
    return await handleCeoGoalIntakeResult({
      source: input.source,
      issue: input.issue,
      parsed: parsed.value,
      nextState: input.nextState,
      runDir: input.runDir,
      startedAtMs: input.startedAtMs,
      count: input.count,
      postVisibleComment: input.postVisibleComment,
      dependencies: input.dependencies,
    });
  }

  if (parsed.value.action === "roundtable") {
    return await handleCeoRoundtableResult({
      source: input.source,
      issue: input.issue,
      parsed: parsed.value,
      nextState: input.nextState,
      runDir: input.runDir,
      startedAtMs: input.startedAtMs,
      count: input.count,
      postVisibleComment: input.postVisibleComment,
      dependencies: input.dependencies,
    });
  }

  const spawnResult = await executeCeoSpawnChildIssues({
    source: input.source,
    workflowId: parsed.value.workflowId,
    groups: parsed.value.groups,
    issues: parsed.value.issues,
    dependencies: input.dependencies,
  });
  if (!spawnResult.ok) {
    const failureBody = formatCeoOrchestrationFailureBody({
      reason: spawnResult.reason,
      completed: spawnResult.completed,
      pending: spawnResult.pending,
    });
    try {
      await input.postVisibleComment(formatBypassedAgentComment("ceo", failureBody, "ceo-orchestration-failed"));
      return "triggered-success";
    } catch (postError) {
      throw new Error(
        `ceo-orchestration-failed:${spawnResult.reason}; fail-closed-comment-failed:${formatFailureReason(
          postError,
        )}; completed=${spawnResult.completed.map((item) => item.issue.url).join(",")}`,
      );
    }
  }

  const successBody = formatCeoSpawnSuccessBody({
    summary: parsed.value.summary,
    groups: parsed.value.groups,
    completed: spawnResult.completed,
  });
  await publishCeoVisibleResult({
    source: input.source,
    issue: input.issue,
    body: successBody,
    runDir: input.runDir,
    startedAtMs: input.startedAtMs,
    count: input.count,
    nextState: input.nextState,
    postVisibleComment: input.postVisibleComment,
    dependencies: input.dependencies,
  });
  return "triggered-success";
}

type ParsedCeoGoalIntake = Extract<ParsedCeoOrchestration, { action: "goal_intake" }>;

async function handleCeoGoalIntakeResult(input: {
  source: IssueSource;
  issue: GitHubIssue;
  parsed: ParsedCeoGoalIntake;
  nextState: NonNullable<ReturnType<typeof resolveNextRoleThreadState>>;
  runDir: string;
  startedAtMs: number;
  count: number;
  postVisibleComment: (body: string) => Promise<void>;
  dependencies: ProcessIssueSourceDependencies;
}): Promise<IssueProcessingOutcome> {
  if (input.parsed.mode === "interview") {
    await publishCeoVisibleResult({
      source: input.source,
      issue: input.issue,
      body: input.parsed.body,
      runDir: input.runDir,
      startedAtMs: input.startedAtMs,
      count: input.count,
      nextState: input.nextState,
      postVisibleComment: input.postVisibleComment,
      dependencies: input.dependencies,
    });
    return "triggered-success";
  }

  if (input.parsed.mode === "propose") {
    const proposalKey = buildGoalIntakeProposalKey({
      source: input.source,
      proposalId: input.parsed.proposalId,
    });
    try {
      await saveGoalIntakeProposalEntries({
        source: input.source,
        issue: input.issue,
        parsed: input.parsed,
        proposalKey,
        dependencies: input.dependencies,
      });
    } catch (error) {
      try {
        await input.postVisibleComment(
          formatBypassedAgentComment(
            "ceo",
            formatCeoOrchestrationFailureBody({
              reason: formatFailureReason(error),
              completed: [],
              pending: [],
            }),
            "goal-intake-failed",
          ),
        );
        return "triggered-success";
      } catch (postError) {
        throw new Error(
          `goal-intake-failed:${formatFailureReason(error)}; fail-closed-comment-failed:${formatFailureReason(postError)}`,
        );
      }
    }

    await publishCeoVisibleResult({
      source: input.source,
      issue: input.issue,
      body: renderGoalIntakeProposalBody({
        confirmationBody: input.parsed.confirmationBody,
        proposalKey,
      }),
      runDir: input.runDir,
      startedAtMs: input.startedAtMs,
      count: input.count,
      nextState: input.nextState,
      postVisibleComment: input.postVisibleComment,
      dependencies: input.dependencies,
    });
    return "triggered-success";
  }

  const completed: CeoSpawnCompletedItem[] = [];
  let pending = [...input.parsed.issues];
  try {
    await confirmGoalIntakeLedgerEntries({
      source: input.source,
      issue: input.issue,
      parsed: input.parsed,
      dependencies: input.dependencies,
    });
    const spawnResult = await executeCeoSpawnChildIssues({
      source: input.source,
      workflowId: input.parsed.workflowId,
      groups: input.parsed.groups,
      issues: input.parsed.issues,
      dependencies: input.dependencies,
    });
    completed.push(...spawnResult.completed);
    pending = spawnResult.ok ? [] : spawnResult.pending;
    if (!spawnResult.ok) {
      throw new Error(spawnResult.reason);
    }
  } catch (error) {
    const failureBody = formatCeoOrchestrationFailureBody({
      reason: formatFailureReason(error),
      completed,
      pending,
    });
    try {
      await input.postVisibleComment(formatBypassedAgentComment("ceo", failureBody, "goal-intake-failed"));
      return "triggered-success";
    } catch (postError) {
      throw new Error(
        `goal-intake-failed:${formatFailureReason(error)}; fail-closed-comment-failed:${formatFailureReason(
          postError,
        )}; completed=${completed.map((item) => item.issue.url).join(",")}`,
      );
    }
  }

  await publishCeoVisibleResult({
    source: input.source,
    issue: input.issue,
    body: formatCeoSpawnSuccessBody({
      summary: input.parsed.summary,
      groups: input.parsed.groups,
      completed,
    }),
    runDir: input.runDir,
    startedAtMs: input.startedAtMs,
    count: input.count,
    nextState: input.nextState,
    postVisibleComment: input.postVisibleComment,
    dependencies: input.dependencies,
  });
  return "triggered-success";
}

type ParsedCeoRoundtable = Extract<ParsedCeoOrchestration, { action: "roundtable" }>;

async function handleCeoRoundtableResult(input: {
  source: IssueSource;
  issue: GitHubIssue;
  parsed: ParsedCeoRoundtable;
  nextState: NonNullable<ReturnType<typeof resolveNextRoleThreadState>>;
  runDir: string;
  startedAtMs: number;
  count: number;
  postVisibleComment: (body: string) => Promise<void>;
  dependencies: ProcessIssueSourceDependencies;
}): Promise<IssueProcessingOutcome> {
  try {
    if (input.parsed.mode === "start") {
      return await handleCeoRoundtableStart(input as typeof input & { parsed: Extract<ParsedCeoRoundtable, { mode: "start" }> });
    }
    if (input.parsed.mode === "route") {
      return await handleCeoRoundtableRoute(input as typeof input & { parsed: Extract<ParsedCeoRoundtable, { mode: "route" }> });
    }
    return await handleCeoRoundtableComplete(input as typeof input & { parsed: Extract<ParsedCeoRoundtable, { mode: "complete" }> });
  } catch (error) {
    try {
      await input.postVisibleComment(
        formatBypassedAgentComment(
          "ceo",
          formatCeoRoundtableFailureBody({ reason: formatFailureReason(error) }),
          "ceo-roundtable-failed",
        ),
      );
      return "triggered-success";
    } catch (postError) {
      throw new Error(
        `ceo-roundtable-failed:${formatFailureReason(error)}; fail-closed-comment-failed:${formatFailureReason(postError)}`,
      );
    }
  }
}

async function handleCeoRoundtableStart(input: {
  source: IssueSource;
  issue: GitHubIssue;
  parsed: Extract<ParsedCeoRoundtable, { mode: "start" }>;
  nextState: NonNullable<ReturnType<typeof resolveNextRoleThreadState>>;
  runDir: string;
  startedAtMs: number;
  count: number;
  postVisibleComment: (body: string) => Promise<void>;
  dependencies: ProcessIssueSourceDependencies;
}): Promise<IssueProcessingOutcome> {
  const roundtableKey = buildCeoRoundtableKey({
    source: input.source,
    workflowId: input.parsed.workflowId,
    roundtableId: input.parsed.roundtableId,
  });
  let completedIssue: CreatedIssue | null = null;
  const existingRef = findTaskChildIssueRefByRoundtableKey(
    await input.dependencies.loadGoalLedgerState(),
    input.parsed.ledgerTaskId,
    roundtableKey,
  );
  if (existingRef !== null) {
    completedIssue = issueFromReference(existingRef);
  } else {
    const lookup = await withTimeout(
      input.dependencies.findIssueByOrchestrationKey(input.source, roundtableKey),
      CEO_ORCHESTRATION_ACTION_TIMEOUT_MS,
      "findRoundtableIssueByKey",
    );
    if (lookup.kind === "multiple") {
      throw new Error(`roundtable-key-multiple-matches:${roundtableKey}:${lookup.issues.map((issue) => issue.url).join(",")}`);
    }
    if (lookup.kind === "one") {
      completedIssue = lookup.issue;
      await saveTaskRoundtableChildIssueRef({
        dependencies: input.dependencies,
        ledgerTaskId: input.parsed.ledgerTaskId,
        issue: completedIssue,
        roundtableKey,
        provenance: input.parsed.provenance,
      });
    } else {
      const body = renderCeoRoundtableChildIssueBody({
        parentIssueUrl: issueUrl(input.source),
        workflowId: input.parsed.workflowId,
        ledgerTaskId: input.parsed.ledgerTaskId,
        roundtableKey,
        title: input.parsed.title,
        topic: input.parsed.topic,
        inputSummary: input.parsed.inputSummary,
        participants: input.parsed.participants,
        firstRole: input.parsed.firstRole,
        qualityBaseline: input.parsed.qualityBaseline,
        provenance: input.parsed.provenance,
      });
      completedIssue = await withTimeout(
        input.dependencies.createIssue(input.source, { title: input.parsed.title, body }),
        CEO_ORCHESTRATION_ACTION_TIMEOUT_MS,
        "createRoundtableIssue",
      );
      try {
        await saveTaskRoundtableChildIssueRef({
          dependencies: input.dependencies,
          ledgerTaskId: input.parsed.ledgerTaskId,
          issue: completedIssue,
          roundtableKey,
          provenance: input.parsed.provenance,
        });
      } catch (error) {
        throw new Error(`roundtable-ledger-save-failed:${formatFailureReason(error)}; child=${completedIssue.url}; key=${roundtableKey}`);
      }
    }
  }

  await publishCeoVisibleResult({
    source: input.source,
    issue: input.issue,
    body: `圆桌已启动。

Child issue: ${completedIssue.url}
Workflow id: ${input.parsed.workflowId}
Participants: ${input.parsed.participants.join(" -> ")}
Current waiting role: ${input.parsed.firstRole}

<!-- ${roundtableKey} -->`,
    runDir: input.runDir,
    startedAtMs: input.startedAtMs,
    count: input.count,
    nextState: input.nextState,
    postVisibleComment: input.postVisibleComment,
    dependencies: input.dependencies,
  });
  return "triggered-success";
}

async function handleCeoRoundtableRoute(input: {
  source: IssueSource;
  issue: GitHubIssue;
  parsed: Extract<ParsedCeoRoundtable, { mode: "route" }>;
  nextState: NonNullable<ReturnType<typeof resolveNextRoleThreadState>>;
  runDir: string;
  startedAtMs: number;
  count: number;
  postVisibleComment: (body: string) => Promise<void>;
  dependencies: ProcessIssueSourceDependencies;
}): Promise<IssueProcessingOutcome> {
  const context = requireRoundtableIssueContext(input.issue.body);
  if (context.roundtableKey !== input.parsed.roundtableKey) {
    throw new Error(`roundtable-key-mismatch:${input.parsed.roundtableKey}`);
  }
  const nextRole = nextRoundtableParticipant(input.issue, context.participants);
  if (nextRole === null) {
    throw new Error("roundtable-route-no-pending-participant");
  }
  if (input.parsed.nextRole !== nextRole) {
    throw new Error(`roundtable-route-wrong-next-role:${input.parsed.nextRole}:expected:${nextRole}`);
  }
  const rendered = renderCeoRoundtableRouteBody({ nextRole, body: input.parsed.body });
  if (!rendered.ok) {
    throw new Error(rendered.reason);
  }
  await publishCeoVisibleResult({
    source: input.source,
    issue: input.issue,
    body: rendered.body,
    runDir: input.runDir,
    startedAtMs: input.startedAtMs,
    count: input.count,
    nextState: input.nextState,
    postVisibleComment: input.postVisibleComment,
    dependencies: input.dependencies,
  });
  return "triggered-success";
}

async function handleCeoRoundtableComplete(input: {
  source: IssueSource;
  issue: GitHubIssue;
  parsed: Extract<ParsedCeoRoundtable, { mode: "complete" }>;
  nextState: NonNullable<ReturnType<typeof resolveNextRoleThreadState>>;
  runDir: string;
  startedAtMs: number;
  count: number;
  postVisibleComment: (body: string) => Promise<void>;
  dependencies: ProcessIssueSourceDependencies;
}): Promise<IssueProcessingOutcome> {
  const context = requireRoundtableIssueContext(input.issue.body);
  if (context.roundtableKey !== input.parsed.roundtableKey) {
    throw new Error(`roundtable-key-mismatch:${input.parsed.roundtableKey}`);
  }
  const participantIndexes = roundtableParticipantMessageIndexes(input.issue, context.participants);
  const missing = context.participants.filter((participant) => participantIndexes[participant] === undefined);
  if (missing.length > 0) {
    await input.postVisibleComment(
      formatBypassedAgentComment(
        "ceo",
        formatCeoRoundtableFailureBody({ reason: `roundtable-participants-missing:${missing.join(",")}` }),
        "ceo-roundtable-failed",
      ),
    );
    return "triggered-success";
  }
  const completionKey = buildCeoRoundtableCompletionKey({
    roundtableKey: context.roundtableKey,
    participants: context.participants,
    participantMessageIndexes: context.participants.map((participant) => participantIndexes[participant]!),
  });
  const parentIssue = await withTimeout(
    input.dependencies.fetchIssueWithComments(context.parentSource),
    CEO_ORCHESTRATION_ACTION_TIMEOUT_MS,
    "fetchRoundtableParent",
  );
  const childUrl = issueUrl(input.source);
  if (!issueContainsHiddenKey(parentIssue, completionKey)) {
    await withTimeout(
      input.dependencies.postComment(
        context.parentSource,
        appendCeoReviewedMetadata(
          formatAgentComment(
            "ceo",
            renderCeoRoundtableParentSummaryBody({
              childIssueUrl: childUrl,
              topic: context.topic,
              summary: input.parsed.summary,
              contributions: input.parsed.contributions,
              decision: input.parsed.decision,
              provenance: input.parsed.provenance,
              completionKey,
            }),
          ),
          { action: "bypass", reason: "roundtable_parent_summary" },
        ),
      ),
      CEO_ORCHESTRATION_ACTION_TIMEOUT_MS,
      "postRoundtableParentSummary",
    );
  }
  await publishCeoVisibleResult({
    source: input.source,
    issue: input.issue,
    body: `圆桌已完成并回流父 issue。

Parent issue: ${issueUrl(context.parentSource)}
Completion key: ${completionKey}`,
    runDir: input.runDir,
    startedAtMs: input.startedAtMs,
    count: input.count,
    nextState: input.nextState,
    postVisibleComment: input.postVisibleComment,
    dependencies: input.dependencies,
  });
  return "triggered-success";
}

async function publishCeoVisibleResult(input: {
  source: IssueSource;
  issue: GitHubIssue;
  body: string;
  runDir: string;
  startedAtMs: number;
  count: number;
  nextState: NonNullable<ReturnType<typeof resolveNextRoleThreadState>>;
  postVisibleComment: (body: string) => Promise<void>;
  dependencies: ProcessIssueSourceDependencies;
}): Promise<void> {
  const body = ensureInProgressStage(input.body);
  const runManifestRecord = buildRunManifestRecord({
    source: input.source,
    role: "ceo",
    finalText: body,
    artifacts: [],
    startedAtMs: input.startedAtMs,
  });
  const ceoResult = await input.dependencies.formatCeoComment({
    agent: "ceo",
    issueContext: buildCeoIssueContext(input.source, input.issue),
    latestResponse: body,
    runDir: input.runDir,
    runCodex: input.dependencies.runCodex,
  });
  logCeoGuardrailResult({
    result: ceoResult,
    count: input.count,
    agent: "ceo",
    issueKey: input.source.issueKey,
  });

  if (ceoResult.action === "APPEND") {
    const originalBody = appendCeoReviewedMetadata(formatAgentComment("ceo", body), {
      action: "append_original",
    });
    await input.postVisibleComment(originalBody);
    const ceoAppendBody = `${appendCeoReviewedMetadata(formatAgentComment(ceoResult.as, ceoResult.body), {
      action: "append_ceo",
    })}\n\n${CEO_CORRECTED_METADATA}`;
    await input.dependencies.postComment(input.source, ceoAppendBody);
  } else {
    await input.postVisibleComment(formatGuardedAgentComment("ceo", ceoResult.body, ceoResult));
  }

  await writeRunManifestBestEffort({
    record: runManifestRecord,
    runDir: input.runDir,
    count: input.count,
    agent: "ceo",
    issueKey: input.source.issueKey,
    dependencies: input.dependencies,
  });
  await input.dependencies.saveRoleThreadStateEntry(input.source.issueKey, "ceo", input.nextState);
}

type ExecuteCeoSpawnChildIssuesResult =
  | { ok: true; completed: CeoSpawnCompletedItem[] }
  | { ok: false; reason: string; completed: CeoSpawnCompletedItem[]; pending: CeoChildIssueDescriptor[] };

async function executeCeoSpawnChildIssues(input: {
  source: IssueSource;
  workflowId: string;
  groups: CeoOrchestrationGroup[];
  issues: CeoChildIssueDescriptor[];
  dependencies: ProcessIssueSourceDependencies;
}): Promise<ExecuteCeoSpawnChildIssuesResult> {
  const completed: CeoSpawnCompletedItem[] = [];
  const pending = [...input.issues];
  try {
    for (const descriptor of input.issues) {
      pending.shift();
      const group = input.groups.find((candidate) => candidate.id === descriptor.groupId);
      if (group === undefined) {
        throw new Error(`missing-group:${descriptor.groupId}`);
      }

      const orchestrationKey = buildCeoOrchestrationKey({
        source: input.source,
        workflowId: input.workflowId,
        ledgerTaskId: descriptor.ledgerTaskId,
      });

      const existingRef = findTaskChildIssueRefByOrchestrationKey(
        await input.dependencies.loadGoalLedgerState(),
        descriptor.ledgerTaskId,
        orchestrationKey,
      );
      if (existingRef !== null) {
        completed.push({
          kind: "already-created",
          descriptor,
          issue: issueFromReference(existingRef),
          orchestrationKey,
        });
        continue;
      }

      const lookup = await withTimeout(
        input.dependencies.findIssueByOrchestrationKey(input.source, orchestrationKey),
        CEO_ORCHESTRATION_ACTION_TIMEOUT_MS,
        "findIssueByOrchestrationKey",
      );
      if (lookup.kind === "multiple") {
        throw new Error(
          `orchestration-key-multiple-matches:${orchestrationKey}:${lookup.issues.map((issue) => issue.url).join(",")}`,
        );
      }
      if (lookup.kind === "one") {
        completed.push({
          kind: "recovered-existing",
          descriptor,
          issue: lookup.issue,
          orchestrationKey,
        });
        await saveTaskChildIssueRef({
          dependencies: input.dependencies,
          ledgerTaskId: descriptor.ledgerTaskId,
          issue: lookup.issue,
          orchestrationKey,
          provenance: descriptor.provenance,
        });
        continue;
      }

      const body = renderCeoChildIssueBody({
        source: input.source,
        parentIssueUrl: issueUrl(input.source),
        workflowId: input.workflowId,
        group,
        descriptor,
        orchestrationKey,
      });
      const created = await withTimeout(
        input.dependencies.createIssue(input.source, { title: descriptor.title, body }),
        CEO_ORCHESTRATION_ACTION_TIMEOUT_MS,
        "createIssue",
      );
      completed.push({
        kind: "created",
        descriptor,
        issue: created,
        orchestrationKey,
      });
      await saveTaskChildIssueRef({
        dependencies: input.dependencies,
        ledgerTaskId: descriptor.ledgerTaskId,
        issue: created,
        orchestrationKey,
        provenance: descriptor.provenance,
      });
    }
    return { ok: true, completed };
  } catch (error) {
    return {
      ok: false,
      reason: formatFailureReason(error),
      completed,
      pending,
    };
  }
}

async function saveGoalIntakeProposalEntries(input: {
  source: IssueSource;
  issue: GitHubIssue;
  parsed: Extract<ParsedCeoGoalIntake, { mode: "propose" }>;
  proposalKey: string;
  dependencies: ProcessIssueSourceDependencies;
}): Promise<void> {
  const ledgerInput = goalIntakeProposalLedgerInput(input);
  const entryIds: Array<{ kind: "goals" | "milestones" | "tasks" | "phases"; id: string }> = [
    { kind: "goals", id: input.parsed.goal.id },
    ...input.parsed.milestones.map((milestone) => ({ kind: "milestones" as const, id: milestone.id })),
    ...input.parsed.tasks.map((task) => ({ kind: "tasks" as const, id: task.id })),
    { kind: "phases", id: input.parsed.phaseOne.id },
  ];

  for (const entryId of entryIds) {
    await withTimeout(
      input.dependencies.saveGoalLedgerEntry(
        entryId.kind,
        entryId.id,
        (_entry, state) => {
          const nextState = applyGoalIntakeProposal(state, ledgerInput);
          return nextState[entryId.kind][entryId.id] ?? null;
        },
        undefined,
        { timeoutMs: CEO_ORCHESTRATION_ACTION_TIMEOUT_MS },
      ),
      CEO_ORCHESTRATION_ACTION_TIMEOUT_MS,
      "saveGoalLedgerEntry",
    );
  }
}

async function confirmGoalIntakeLedgerEntries(input: {
  source: IssueSource;
  issue: GitHubIssue;
  parsed: Extract<ParsedCeoGoalIntake, { mode: "confirm" }>;
  dependencies: ProcessIssueSourceDependencies;
}): Promise<void> {
  const loaded = await withTimeout(
    input.dependencies.loadGoalLedgerState(),
    CEO_ORCHESTRATION_ACTION_TIMEOUT_MS,
    "loadGoalLedgerState",
  );
  validateGoalIntakeConfirmAgainstLedger(loaded, input.parsed);
  const now = new Date().toISOString();
  const confirmInput = {
    proposalKey: input.parsed.proposalKey,
    taskIds: input.parsed.issues.map((issue) => issue.ledgerTaskId),
    now,
    provenance: {
      issue: {
        owner: input.source.owner,
        repo: input.source.repo,
        number: input.source.issueNumber,
      },
      messageIndex: countMessages(input.issue.comments.length),
      ...(input.issue.comments.at(-1)?.id === undefined ? {} : { commentId: input.issue.comments.at(-1)!.id }),
      capturedAt: now,
      note: truncateForComment(`${input.parsed.proposalKey}; ${input.parsed.provenance.replace(/\s+/g, " ").trim()}`, 500),
    },
  };
  const bundle = resolveGoalIntakeProposal(loaded, input.parsed.proposalKey);
  if (bundle === null) {
    throw new Error(`missing-goal-intake-proposal:${input.parsed.proposalKey}`);
  }
  const entryIds: Array<{ kind: "goals" | "tasks" | "phases"; id: string }> = [
    { kind: "goals", id: bundle.goal.id },
    ...bundle.tasks.map((task) => ({ kind: "tasks" as const, id: task.id })),
    { kind: "phases", id: bundle.phase.id },
  ];
  for (const entryId of entryIds) {
    await withTimeout(
      input.dependencies.saveGoalLedgerEntry(
        entryId.kind,
        entryId.id,
        (_entry, state) => {
          const nextState = confirmGoalIntakeProposal(state, confirmInput);
          return nextState[entryId.kind][entryId.id] ?? null;
        },
        undefined,
        { timeoutMs: CEO_ORCHESTRATION_ACTION_TIMEOUT_MS },
      ),
      CEO_ORCHESTRATION_ACTION_TIMEOUT_MS,
      "saveGoalLedgerEntry",
    );
  }
}

function goalIntakeProposalLedgerInput(input: {
  source: IssueSource;
  issue: GitHubIssue;
  parsed: Extract<ParsedCeoGoalIntake, { mode: "propose" }>;
  proposalKey: string;
}): Parameters<typeof applyGoalIntakeProposal>[1] {
  const capturedAt = new Date().toISOString();
  const latestComment = input.issue.comments.at(-1);
  return {
    proposalKey: input.proposalKey,
    sourceIssue: {
      owner: input.source.owner,
      repo: input.source.repo,
      number: input.source.issueNumber,
    },
    messageIndex: countMessages(input.issue.comments.length),
    ...(latestComment?.id === undefined ? {} : { commentId: latestComment.id }),
    capturedAt,
    provenanceNote: input.parsed.provenance,
    goal: input.parsed.goal,
    milestones: input.parsed.milestones,
    phaseOne: input.parsed.phaseOne,
    tasks: input.parsed.tasks.map((task) => ({
      id: task.id,
      milestoneId: task.milestoneId,
      title: task.title,
      scope: task.scope,
      acceptanceStatements: task.acceptanceStatements,
      dependencies: task.dependencies,
      qualityBaseline: task.qualityBaseline,
      provenance: task.provenance,
    })),
  };
}

function validateGoalIntakeConfirmAgainstLedger(
  ledger: GoalLedgerState,
  parsed: Extract<ParsedCeoGoalIntake, { mode: "confirm" }>,
): void {
  if (extractGoalIntakeProposalKey(parsed.proposalKey) !== parsed.proposalKey) {
    throw new Error(`invalid-goal-intake-proposal-key:${parsed.proposalKey}`);
  }
  const bundle = resolveGoalIntakeProposal(ledger, parsed.proposalKey);
  if (bundle === null) {
    throw new Error(`missing-goal-intake-proposal:${parsed.proposalKey}`);
  }
  const pendingTaskIds = new Set(bundle.tasks.map((task) => task.id));
  const issueTaskIds = new Set(parsed.issues.map((issue) => issue.ledgerTaskId));
  if (pendingTaskIds.size !== issueTaskIds.size || [...pendingTaskIds].some((taskId) => !issueTaskIds.has(taskId))) {
    throw new Error(`goal-intake-confirm-task-mismatch:${[...pendingTaskIds].sort().join(",")}:${[...issueTaskIds].sort().join(",")}`);
  }
  for (const descriptor of parsed.issues) {
    const task = bundle.tasks.find((candidate) => candidate.id === descriptor.ledgerTaskId);
    if (task === undefined) {
      throw new Error(`goal-intake-confirm-task-missing:${descriptor.ledgerTaskId}`);
    }
    if (task.qualityBaseline !== descriptor.qualityBaseline) {
      throw new Error(`goal-intake-confirm-quality-baseline-mismatch:${descriptor.ledgerTaskId}`);
    }
    if (JSON.stringify(task.acceptanceStatements ?? []) !== JSON.stringify(descriptor.acceptanceStatements)) {
      throw new Error(`goal-intake-confirm-acceptance-mismatch:${descriptor.ledgerTaskId}`);
    }
    if (JSON.stringify(task.dependencies ?? []) !== JSON.stringify(descriptor.dependencies)) {
      throw new Error(`goal-intake-confirm-dependencies-mismatch:${descriptor.ledgerTaskId}`);
    }
  }
}

function formatCeoSpawnSuccessBody(input: {
  summary: string;
  groups: CeoOrchestrationGroup[];
  completed: CeoSpawnCompletedItem[];
}): string {
  const issueLines =
    input.completed.length === 0
      ? "- none"
      : input.completed
          .map((item) => `- ${item.kind}: ${item.descriptor.ledgerTaskId} -> ${item.issue.url}`)
          .join("\n");
  const groupLines = input.groups.map((group) => `- ${group.id}: ${group.reason}`).join("\n");

  return `CEO 编排完成。

${input.summary}

子 issue：
${issueLines}

冲突分组：
${groupLines}

<!-- moebius:stage=in-progress -->`;
}

function formatCeoRoundtableFailureBody(input: { reason: string }): string {
  return `CEO 圆桌路径 fail-closed：${input.reason}

本轮不会继续推进圆桌，也不会更新 ceo role thread。若已有 child issue 或父 issue 可见结果，下一轮会先按 hidden key 查找并恢复，避免重复创建或重复回流。

<!-- moebius:stage=in-progress -->`;
}

interface RoleThreadContextProof {
  provider: "codex";
  contextFingerprint: string;
  workspaceFingerprint: string;
  personaFingerprint: string;
}

function buildRoleThreadContextProof(input: {
  role: string;
  agentMarkdown: string;
  cwd: string | undefined;
}): RoleThreadContextProof {
  const workspaceFingerprint = hashValue({
    cwd: input.cwd ?? null,
  });
  const personaFingerprint = hashValue({
    role: input.role,
    agentMarkdown: input.agentMarkdown,
  });
  return {
    provider: "codex",
    workspaceFingerprint,
    personaFingerprint,
    contextFingerprint: hashValue({
      provider: "codex",
      workspaceFingerprint,
      personaFingerprint,
    }),
  };
}

function roleThreadContextCompatible(
  state: {
    provider?: "codex";
    contextFingerprint?: string;
    workspaceFingerprint?: string;
    personaFingerprint?: string;
  },
  proof: RoleThreadContextProof,
): boolean {
  return (
    (state.provider === undefined || state.provider === proof.provider)
    && (
      state.contextFingerprint === undefined
      || state.contextFingerprint === proof.contextFingerprint
    )
    && (
      state.workspaceFingerprint === undefined
      || state.workspaceFingerprint === proof.workspaceFingerprint
    )
    && (
      state.personaFingerprint === undefined
      || state.personaFingerprint === proof.personaFingerprint
    )
  );
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function appendPromptContext(prompt: string, promptContext: string | undefined): string {
  if (promptContext === undefined || promptContext.trim() === "") {
    return prompt;
  }

  return `${prompt.trimEnd()}

## Agent Execution Context

${promptContext.trimEnd()}`;
}

async function prepareMediaForPrompt(input: {
  messages: TimelineMessage[];
  runDir: string;
  count: number;
  agent: string;
  issueKey: string;
  dependencies: ProcessIssueSourceDependencies;
}): Promise<{ ok: true; prepared: MediaPromptEntry[]; imagePaths: string[] } | { ok: false; failures: MediaPreparationFailure[] }> {
  const references = extractIssueMediaReferences(input.messages);
  if (references.length === 0) {
    return { ok: true, prepared: [], imagePaths: [] };
  }

  const result = await input.dependencies.prepareIssueMedia({ references, runDir: input.runDir });
  if (!result.ok) {
    log({
      event: "issue-media-preparation-failed",
      count: input.count,
      runDir: input.runDir,
      agent: input.agent,
      issueKey: input.issueKey,
      failures: result.failures.map((failure) => failure.reason),
    });
    return result;
  }

  log({
    event: "issue-media-prepared",
    count: input.count,
    runDir: input.runDir,
    agent: input.agent,
    issueKey: input.issueKey,
    mediaCount: result.prepared.length,
    imageCount: result.imagePaths.length,
  });
  return result;
}

async function buildPublishableFinalText(input: {
  source: IssueSource;
  finalText: string;
  runDir: string;
  cwd: string | undefined;
  startedAtMs: number;
  count: number;
  agent: string;
  dependencies: ProcessIssueSourceDependencies;
}): Promise<{ ok: true; body: string; artifacts: RunManifestRecord["artifacts"] } | { ok: false; error: unknown; artifacts: RunManifestRecord["artifacts"] }> {
  const artifacts = await input.dependencies.discoverOutputArtifacts({
    cwd: input.cwd,
    runDir: input.runDir,
    finalText: input.finalText,
    startedAtMs: input.startedAtMs,
  });
  if (artifacts.length === 0) {
    return { ok: true, body: input.finalText, artifacts: [] };
  }

  const stagedArtifacts = artifacts.map((artifact) => ({
    path: toManifestArtifactPath(input.runDir, artifact.filePath),
    publishedUrl: null,
  }));

  try {
    const publishedArtifacts = await input.dependencies.publishArtifacts(input.source, artifacts);
    const artifactMarkdown = formatPublishedArtifactsMarkdown(publishedArtifacts);
    const manifestArtifacts = stagedArtifacts.map((artifact, index) => ({
      ...artifact,
      publishedUrl: publishedArtifacts[index]?.url ?? null,
    }));
    log({
      event: "output-artifacts-published",
      count: input.count,
      runDir: input.runDir,
      agent: input.agent,
      issueKey: input.source.issueKey,
      artifactCount: publishedArtifacts.length,
    });
    return {
      ok: true,
      body: artifactMarkdown === "" ? input.finalText : `${input.finalText.trimEnd()}\n\n${artifactMarkdown}`,
      artifacts: manifestArtifacts,
    };
  } catch (error) {
    log({
      event: "output-artifact-publish-failed",
      count: input.count,
      runDir: input.runDir,
      agent: input.agent,
      issueKey: input.source.issueKey,
      error: formatError(error),
    });
    return { ok: false, error, artifacts: stagedArtifacts };
  }
}

function buildRunManifestRecord(input: {
  source: IssueSource;
  role: string;
  finalText: string;
  artifacts: RunManifestRecord["artifacts"];
  startedAtMs: number;
  completedAt?: Date;
}): RunManifestRecord {
  return {
    issue: {
      owner: input.source.owner,
      repo: input.source.repo,
      number: input.source.issueNumber,
    },
    role: input.role,
    stage: resolveRunManifestStage(input.finalText),
    artifacts: input.artifacts,
    startedAt: new Date(input.startedAtMs).toISOString(),
    completedAt: (input.completedAt ?? new Date()).toISOString(),
  };
}

function resolveRunManifestStage(finalText: string): RunManifestStage {
  return (parseTrailingStageMarker(finalText) as RunManifestStage | null) ?? "unknown";
}

function toManifestArtifactPath(runDir: string, filePath: string): string {
  const relative = path.relative(path.resolve(runDir), path.resolve(filePath));
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return path.basename(filePath);
  }

  return relative.split(path.sep).join(path.posix.sep);
}

async function writeRunManifestBestEffort(input: {
  record: RunManifestRecord;
  runDir: string;
  count: number;
  agent: string;
  issueKey: string;
  dependencies: ProcessIssueSourceDependencies;
}): Promise<void> {
  try {
    await input.dependencies.writeRunManifest({ record: input.record, runDir: input.runDir });
    log({
      event: "run-manifest-written",
      count: input.count,
      runDir: input.runDir,
      agent: input.agent,
      issueKey: input.issueKey,
      artifactCount: input.record.artifacts.length,
      stage: input.record.stage,
    });
  } catch (error) {
    log({
      event: "run-manifest-write-failed",
      count: input.count,
      runDir: input.runDir,
      agent: input.agent,
      issueKey: input.issueKey,
      error: formatError(error),
    });
  }
}

function logCeoGuardrailResult(input: {
  result: FormatCeoResult;
  count: number;
  agent: string;
  issueKey: string;
}): void {
  if (input.result.action === "REPLACE") {
    log({
      event: "ceo-guardrail-repaired",
      count: input.count,
      agent: input.agent,
      reason: input.result.reason,
      issueKey: input.issueKey,
    });
    return;
  }

  if (input.result.action === "APPEND") {
    log({
      event: "ceo-guardrail-appended",
      count: input.count,
      agent: input.agent,
      as: input.result.as,
      reason: input.result.reason,
      issueKey: input.issueKey,
    });
    return;
  }

  if (input.result.action === "NO_CHANGE") {
    log({
      event: "ceo-guardrail-noop",
      count: input.count,
      agent: input.agent,
      reason: input.result.reason,
      issueKey: input.issueKey,
    });
    return;
  }

  log({
    event: "ceo-guardrail-failopen",
    count: input.count,
    agent: input.agent,
    reason: input.result.reason,
    detail: input.result.detail,
    issueKey: input.issueKey,
  });
}

export interface StartedRuntime {
  mode: RuntimeMode;
  close(): Promise<void>;
}

export interface StartDependencies {
  startLocalConsoleServer: typeof startLocalConsoleServer;
  prepareGitHubRunnerState: typeof prepareGitHubRunnerState;
  createRunner: typeof createRunner;
  setInterval(callback: () => void, delayMs: number): NodeJS.Timeout;
  clearInterval(timer: NodeJS.Timeout): void;
}

export interface StartOptions {
  mode?: RuntimeMode;
  argv?: readonly string[];
  dependencies?: Partial<StartDependencies>;
}

const DEFAULT_START_DEPENDENCIES: StartDependencies = {
  startLocalConsoleServer,
  prepareGitHubRunnerState,
  createRunner,
  setInterval,
  clearInterval,
};

export async function prepareGitHubRunnerState(): Promise<GitHubResponseIntakeState> {
  const initialState = await loadGitHubResponseIntakeState();
  await loadRoleThreadStateStore();
  await loadAgentContextStateStore();
  await loadGoalLedgerState();
  return initialState;
}

export async function start(options: StartOptions = {}): Promise<StartedRuntime> {
  const mode = options.mode ?? resolveRuntimeMode(options.argv ?? process.argv.slice(2));
  const dependencies: StartDependencies = {
    ...DEFAULT_START_DEPENDENCIES,
    ...options.dependencies,
  };
  log({ event: "start", mode, config: CONFIG_LOG_FIELDS });

  if (mode === "local") {
    const server = await dependencies.startLocalConsoleServer();
    return {
      mode,
      close: () => server.close(),
    };
  }

  const runner = dependencies.createRunner({ initialState: await dependencies.prepareGitHubRunnerState() });
  void runner.heartbeat();
  const timer = dependencies.setInterval(() => {
    void runner.heartbeat();
  }, TICK_INTERVAL_MS);
  return {
    mode,
    async close() {
      dependencies.clearInterval(timer);
      await closeSqliteStateWorkers();
    },
  };
}

export function makeRunDir(count: number, now = new Date()): string {
  runDirSequence += 1;
  return path.join(TMP_ROOT, `moebius-${now.toISOString()}-c${count}-r${runDirSequence}`);
}

async function listAgentFiles(dir = AGENTS_DIR): Promise<AgentFile[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => ({
      name: path.basename(entry.name, ".md"),
      path: path.join(dir, entry.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function issueSummaryFromSource(source: IssueSource, updatedAt: string): IssueSummary {
  return {
    owner: source.owner,
    repo: source.repo,
    issueNumber: source.issueNumber,
    updatedAt,
  };
}

export function formatDeadLetterComment(input: {
  agent: string;
  reason: string;
  failureCount: number;
}): string {
  const reason = truncateForComment(input.reason.trim() === "" ? "unknown failure" : input.reason.trim(), 2_000);
  return `Moebius dead letter

Target agent: ${input.agent}
Failure reason: ${reason}
Failure count: ${String(input.failureCount)}

Recovery: fix the underlying problem, then add any new comment to this issue to trigger processing again.

<!-- moebius:dead-letter -->

<!-- moebius:ceo-reviewed action=not_applicable reason=dead-letter -->`;
}

function startAgentRunInterruptMonitor(input: {
  source: IssueSource;
  agent: string;
  baselineMessageCount: number;
  controller: AbortController;
  fetchIssueWithComments: typeof fetchIssueWithComments;
}): PollingConversationInterruptMonitor | null {
  if (input.agent !== "dev") {
    return null;
  }

  return startPollingConversationInterruptMonitor({
    baselineSnapshot: { messageCount: input.baselineMessageCount },
    intervalMs: RUNNING_AGENT_INTERRUPT_POLL_INTERVAL_MS,
    fetchSnapshot: async () => {
      const issue = await input.fetchIssueWithComments(input.source, { signal: input.controller.signal });
      return { messageCount: countMessages(issue.comments.length) };
    },
    onInterrupt: (interrupt) => {
      logAgentRunInterrupt({
        agent: input.agent,
        source: input.source,
        interrupt,
      });
      input.controller.abort(formatConversationInterrupt(interrupt));
    },
    onError: (error) => {
      log({
        event: "agent-run-interrupt-check-failed",
        agent: input.agent,
        issueKey: input.source.issueKey,
        error: formatError(error),
      });
    },
  });
}

async function checkAgentRunInterrupt(input: {
  source: IssueSource;
  agent: string;
  baselineMessageCount: number;
  fetchIssueWithComments: typeof fetchIssueWithComments;
}): Promise<ConversationInterrupt | null> {
  if (input.agent !== "dev") {
    return null;
  }

  const issue = await input.fetchIssueWithComments(input.source);
  return resolveConversationInterrupt({
    baselineSnapshot: { messageCount: input.baselineMessageCount },
    currentSnapshot: { messageCount: countMessages(issue.comments.length) },
  });
}

function logAgentRunInterrupt(input: { source: IssueSource; agent: string; interrupt: ConversationInterrupt }): void {
  log({
    event: "agent-run-interrupt",
    reason: input.interrupt.reason,
    baselineMessageCount: input.interrupt.baselineMessageCount,
    currentMessageCount: input.interrupt.currentMessageCount,
    agent: input.agent,
    issueKey: input.source.issueKey,
  });
}

process.on("unhandledRejection", (reason) => {
  log({ event: "unhandled-rejection", error: formatError(reason) });
});

process.on("uncaughtException", (error) => {
  log({ event: "uncaught-exception", error: formatError(error) });
});

export function isDirectRun(modulePath: string, argvPath: string | undefined): boolean {
  return argvPath !== undefined && path.basename(modulePath) === "runner.ts" && path.resolve(argvPath) === modulePath;
}

if (isDirectRun(fileURLToPath(import.meta.url), process.argv[1])) {
  void start().catch((error) => {
    log({ event: "start-failed", error: formatError(error) });
    process.exitCode = 1;
  });
}
