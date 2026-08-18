import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import type { LocalConsoleMessageCommandRuntime } from "./message-command-runtime.js";
import { createLocalMessageRetryWiring } from "./message-retry-wiring.js";
import type { LocalPendingProcessingRuntime } from "./pending-processing-runtime.js";
import type { LocalRunLifecycleRuntime } from "./run-lifecycle-runtime.js";
import type { LocalConsoleRunRetryRuntime } from "./run-retry-runtime.js";
import type { LocalRuntimeAdapters } from "./runtime-adapters.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import type { LocalRuntimeWiringContext } from "./runtime-wiring-context.js";
import { createLocalSessionCommandWiring } from "./session-command-wiring.js";
import type { LocalSessionContinuationRuntime } from "./session-continuation-runtime.js";
import { createLocalSessionMetadataWiring } from "./session-metadata-wiring.js";
import type { LocalConsoleSessionMetadataRuntime } from "./session-metadata-runtime.js";
import type { LocalSessionPresentationRuntime } from "./session-presentation-runtime.js";
import { createLocalSessionReadWiring } from "./session-read-wiring.js";
import type { LocalConversationWorkspaceRuntime } from "./conversation-workspace-runtime.js";
import type { LocalExecutionRunner } from "./execution-driver.js";
import { LocalConsoleSessionTitleRuntime } from "./session-title-runtime.js";
import {
  formatTitleOneShotError,
  planTitleGenerationEnablement,
  projectTitleOneShotResult,
} from "./session-title-plan.js";
import { decideRuntimeCapability } from "./runtime-domain.js";

type PendingPorts = ConstructorParameters<typeof LocalPendingProcessingRuntime>[0];
type MessagePorts = ConstructorParameters<typeof LocalConsoleMessageCommandRuntime>[0];
type RetryPorts = ConstructorParameters<typeof LocalConsoleRunRetryRuntime>[0];
type MetadataPorts = ConstructorParameters<typeof LocalConsoleSessionMetadataRuntime>[0];

export function createLocalRuntimeSessionWiring(input: {
  context: LocalRuntimeWiringContext;
  options: LocalConsoleRuntimeOptions;
  adapters: LocalRuntimeAdapters;
  activeRuns: LocalActiveRunRegistry;
  lifecycle: LocalRunLifecycleRuntime;
  continuation: LocalSessionContinuationRuntime;
  presentation: LocalSessionPresentationRuntime;
  conversationWorkspace: LocalConversationWorkspaceRuntime;
  executionRunner: LocalExecutionRunner;
  makeTitleRunDir(sessionId: string): string;
  defaultSessionId: string;
  inactiveSessions: Set<string>;
  baselineCommits: Map<string, string | null>;
  lastError(): string | null;
  scheduleWorkerWake: MessagePorts["scheduleWorkerWake"];
  processPending: MessagePorts["processPending"];
  schedulePendingProcessing: MessagePorts["schedulePendingProcessing"];
  enableSessionTitleGeneration: boolean;
  runRetryAfterCurrent: RetryPorts["runRetryAfterCurrent"];
  repairStale: PendingPorts["repairStale"];
  applyPendingContext: PendingPorts["applyPendingContext"];
  continuableWorkspace: PendingPorts["continuableWorkspace"];
  dispatchWorkers: PendingPorts["dispatchWorkers"];
  executePrimary: PendingPorts["executePrimary"];
  loadCeoScripts: MetadataPorts["loadCeoScripts"];
}) {
  const titleEnablement = planTitleGenerationEnablement(input.enableSessionTitleGeneration);
  const titleRuntime = new LocalConsoleSessionTitleRuntime({
    nowIso: input.context.nowIso,
    makeTitleRunDir: input.makeTitleRunDir,
    oneShot: titleEnablement.kind === "enabled"
      ? {
          run: async ({ profile, prompt, runDir }) => {
            try {
              const result = await input.executionRunner({
                prompt,
                runDir,
                cwd: runDir,
                profile,
                mode: { kind: "full" },
              });
              return projectTitleOneShotResult(result);
            } catch (error) {
              return { ok: false, reason: formatTitleOneShotError(error) };
            }
          },
        }
      : {
          run: async () => ({ ok: false, reason: "session title generation disabled" }),
        },
    sessionPrimaryProfile: async (sessionId) => {
      const snapshot = await input.context.storePorts.call(
        "local-console-store-list-session-agent-team-snapshot",
        async () => (await input.options.store.listSessionAgentTeamSnapshot?.(sessionId)) ?? null,
      );
      const primary = snapshot?.members[0];
      return primary?.executionProfile ?? null;
    },
    renameSession: (renameInput) => {
      const capability = decideRuntimeCapability(input.options.store.renameSession);
      if (capability.kind === "unavailable") throw new Error("local console session rename unavailable");
      return capability.capability.call(input.options.store, renameInput);
    },
    reportError: (event, error) => input.adapters.report({ event, error }),
  });
  const fireTitleGeneration: (titleInput: { sessionId: string; firstMessageBody: string }) => void = (titleInput) => {
    void titleRuntime.generateTitle(titleInput.sessionId, titleInput.firstMessageBody);
  };
  const messageRetry = createLocalMessageRetryWiring({
    context: input.context,
    options: input.options,
    defaultSessionId: input.defaultSessionId,
    lifecycle: input.lifecycle,
    continuation: input.continuation,
    scheduleWorkerWake: input.scheduleWorkerWake,
    processPending: input.processPending,
    schedulePendingProcessing: input.schedulePendingProcessing,
    runRetryAfterCurrent: input.runRetryAfterCurrent,
    generateSessionTitle: fireTitleGeneration,
    ...input.adapters,
  });
  return {
    messageRetry,
    pending: {
      stopping: input.context.stopping,
      repairStale: input.repairStale,
      applyPendingContext: input.applyPendingContext,
      continuableWorkspace: input.continuableWorkspace,
      dispatchWorkers: input.dispatchWorkers,
      hasPersistedPrimary: messageRetry.hasPersistedPrimary,
      executePrimary: input.executePrimary,
      listSessions: () => input.context.storePorts.call(
        "local-console-store-list-sessions",
        () => input.options.store.listSessions(),
      ),
      formatError: input.context.formatAndSetError,
      setError: input.context.setError,
      report: (event, error) => input.adapters.report({ event, error }),
    } satisfies PendingPorts,
    command: createLocalSessionCommandWiring({
      options: input.options,
      context: input.context,
      activeRuns: input.activeRuns,
      lifecycle: input.lifecycle,
      continuation: input.continuation,
      inactiveSessions: input.inactiveSessions,
      baselineCommits: input.baselineCommits,
      processPending: input.processPending,
      generateSessionTitle: fireTitleGeneration,
      ...input.adapters,
      invalidateWorkspaceFacts: input.adapters.invalidateWorkspace,
      logBaselineUnavailable: ({ projectId, error }) => input.adapters.report({
        event: "local-console-conversation-baseline-unavailable",
        projectId,
        error,
      }),
    }),
    read: createLocalSessionReadWiring({
      options: input.options,
      context: input.context,
      activeRuns: input.activeRuns,
      lifecycle: input.lifecycle,
      continuation: input.continuation,
      presentation: input.presentation,
      conversationWorkspace: input.conversationWorkspace,
      adapters: input.adapters,
      defaultSessionId: input.defaultSessionId,
      lastError: input.lastError,
    }),
    metadata: createLocalSessionMetadataWiring({
      context: input.context,
      options: input.options,
      activeRuns: input.activeRuns,
      continuation: input.continuation,
      loadCeoScripts: input.loadCeoScripts,
      processPending: input.processPending,
      reportError: (event, error, originalError) => input.adapters.report({ event, error, originalError }),
    }),
  };
}
