import path from "node:path";
import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import type { LocalConversationWorkspaceRuntime } from "./conversation-workspace-runtime.js";
import type { LocalPendingSessionContextRuntime } from "./pending-session-context-runtime.js";
import type { LocalRunFailureRuntime } from "./run-failure-runtime.js";
import type { LocalRunLifecycleRuntime } from "./run-lifecycle-runtime.js";
import type { LocalRunRecoveryRuntime } from "./run-recovery-runtime.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import type { LocalRuntimeWiringContext } from "./runtime-wiring-context.js";
import type { LocalSessionContinuationRuntime } from "./session-continuation-runtime.js";
import type { LocalSessionPresentationRuntime } from "./session-presentation-runtime.js";
import { decideTeamSnapshotLoad, planSessionHasActiveRun } from "./session-settings-plan.js";

type ConversationPorts = ConstructorParameters<typeof LocalConversationWorkspaceRuntime>[0];
type ContinuationPorts = ConstructorParameters<typeof LocalSessionContinuationRuntime>[0];
type FailurePorts = ConstructorParameters<typeof LocalRunFailureRuntime>[0];
type LifecyclePorts = ConstructorParameters<typeof LocalRunLifecycleRuntime>[0];
type PresentationPorts = ConstructorParameters<typeof LocalSessionPresentationRuntime>[0];
type PendingContextPorts = ConstructorParameters<typeof LocalPendingSessionContextRuntime>[0];
type RecoveryPorts = ConstructorParameters<typeof LocalRunRecoveryRuntime>[0];

export function createLocalRuntimeFoundationWiring(input: {
  context: LocalRuntimeWiringContext;
  options: LocalConsoleRuntimeOptions;
  activeRuns: LocalActiveRunRegistry;
  baselineCommits: Map<string, string | null>;
  worktreePath: ConversationPorts["worktreePath"];
  readWorkspaceDiff: ConversationPorts["readWorkspaceDiff"];
  readGitStatus: ConversationPorts["readGitStatus"];
  generateWorkspaceDiff: ConversationPorts["generateWorkspaceDiff"];
  resolveWorkspaceSource: ConversationPorts["resolveWorkspaceSource"];
  directoryAvailable: ContinuationPorts["directoryAvailable"];
  fileAvailable: PresentationPorts["fileAvailable"];
  readWorkspaceFacts: PresentationPorts["readWorkspaceFacts"];
  readRecoveryFacts: RecoveryPorts["readRecoveryFacts"];
  timeoutKind: FailurePorts["timeoutKind"];
  interrupted: FailurePorts["interrupted"];
  interruptionCause: FailurePorts["interruptionCause"];
  getSessionFactLogPath(sessionId: string): string;
  hasScheduledWorker(sessionId: string): boolean;
  report(input: { event: string; [key: string]: unknown }): void;
}) {
  const { context, options } = input;
  const workspaceTimeout = decideTeamSnapshotLoad(options.workspaceGitTimeoutMs !== undefined);
  const teamHealth = decideTeamSnapshotLoad(options.resolveAgentTeamHealth !== undefined);
  return {
    conversation: {
      store: options.store,
      storeCall: (label, operation) => context.storePorts.call(label, operation),
      baselineCommits: input.baselineCommits,
      workdirRoot: options.workdirRoot,
      ...(workspaceTimeout.kind === "load" ? { gitTimeoutMs: options.workspaceGitTimeoutMs! } : {}),
      nowIso: context.nowIso,
      worktreePath: input.worktreePath,
      readWorkspaceDiff: input.readWorkspaceDiff,
      readGitStatus: input.readGitStatus,
      generateWorkspaceDiff: input.generateWorkspaceDiff,
      recordWorkspaceDiff: (recordInput) => context.storePorts.sessionFacts().recordWorkspaceDiff(recordInput),
      workspacePatchPath: (runDir) => path.join(runDir, "workspace.patch"),
      reportWorkspaceDiffError: (error, sessionId, runId) =>
        input.report({ event: "local-console-workspace-diff-failed", error, sessionId, runId }),
      resolveWorkspaceSource: input.resolveWorkspaceSource,
      recordProjectWorkspaceStatus: (statusInput) => options.store.recordProjectWorkspaceStatus(statusInput),
    } satisfies ConversationPorts,
    continuation: {
      store: options.store,
      storeCall: (label, operation) => context.storePorts.call(label, operation),
      directoryAvailable: input.directoryAvailable,
      ...(teamHealth.kind === "load" ? { resolveAgentTeamHealth: options.resolveAgentTeamHealth! } : {}),
    } satisfies ContinuationPorts,
    failure: {
      store: options.store,
      storeCall: (label, operation) => context.storePorts.call(label, operation),
      nowIso: context.nowIso,
      timeoutKind: input.timeoutKind,
      interrupted: input.interrupted,
      interruptionCause: input.interruptionCause,
      logTimeout: (timeoutInput) => input.report(timeoutInput),
      activeRun: (runId) => input.activeRuns.get(runId),
      recordError: (event, error, originalError) =>
        input.report({ event, error: context.formatAndSetError(error), originalError }),
    } satisfies FailurePorts,
    lifecycle: {
      activeRun: (runId) => input.activeRuns.get(runId),
      activeRuns: () => input.activeRuns.values(),
      lifecycleStore: () => context.storePorts.lifecycleFacts(),
      storeCall: (label, operation) => context.storePorts.call(label, operation),
      now: context.now,
      nowIso: context.nowIso,
      recordError: (error) => { context.formatAndSetError(error); },
    } satisfies LifecyclePorts,
    presentation(
      continuation: LocalSessionContinuationRuntime,
      lifecycle: LocalRunLifecycleRuntime,
    ): PresentationPorts {
      return {
        store: options.store,
        storeCall: (label, operation) => context.storePorts.call(label, operation),
        nowIso: context.nowIso,
        withAgentTeamHealth: (session) => continuation.withAgentTeamHealth(session),
        activeRuns: () => input.activeRuns.values(),
        activeRunCount: (sessionId) => lifecycle.runsForSession(sessionId).length,
        getSessionFactLogPath: input.getSessionFactLogPath,
        workdirRoot: options.workdirRoot,
        ...(workspaceTimeout.kind === "load" ? { gitTimeoutMs: options.workspaceGitTimeoutMs! } : {}),
        readWorkspaceFacts: input.readWorkspaceFacts,
        worktreePath: input.worktreePath,
        directoryAvailable: input.directoryAvailable,
        fileAvailable: input.fileAvailable,
      };
    },
    pendingContext(lifecycle: LocalRunLifecycleRuntime): PendingContextPorts {
      return {
        store: options.store,
        storeCall: (label, operation) => context.storePorts.call(label, operation),
        nowIso: context.nowIso,
        hasActiveRun: (sessionId) => planSessionHasActiveRun(lifecycle.runsForSession(sessionId).length),
        hasScheduledWorker: input.hasScheduledWorker,
        listAgentNames: async (sessionId) =>
          (await options.listAgentFiles(sessionId)).map((agent) => agent.name),
      };
    },
    recovery: {
      store: options.store,
      storeCall: (label, operation) => context.storePorts.call(label, operation),
      nowIso: context.nowIso,
      recoveryStore: () => context.storePorts.recoveryFacts(),
      requireRecoveryStore: () => context.storePorts.requireRecoveryFacts(),
      lifecycleStore: () => context.storePorts.lifecycleFacts(),
      readRecoveryFacts: input.readRecoveryFacts,
    } satisfies RecoveryPorts,
  };
}
