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
  defaultSessionId: string;
  inactiveSessions: Set<string>;
  baselineCommits: Map<string, string | null>;
  lastError(): string | null;
  scheduleWorkerWake: MessagePorts["scheduleWorkerWake"];
  processPending: MessagePorts["processPending"];
  schedulePendingProcessing: MessagePorts["schedulePendingProcessing"];
  processAfterCurrent: RetryPorts["processAfterCurrent"];
  repairStale: PendingPorts["repairStale"];
  applyPendingContext: PendingPorts["applyPendingContext"];
  continuableWorkspace: PendingPorts["continuableWorkspace"];
  dispatchWorkers: PendingPorts["dispatchWorkers"];
  executePrimary: PendingPorts["executePrimary"];
  loadCeoScripts: MetadataPorts["loadCeoScripts"];
}) {
  const messageRetry = createLocalMessageRetryWiring({
    context: input.context,
    options: input.options,
    defaultSessionId: input.defaultSessionId,
    lifecycle: input.lifecycle,
    continuation: input.continuation,
    scheduleWorkerWake: input.scheduleWorkerWake,
    processPending: input.processPending,
    schedulePendingProcessing: input.schedulePendingProcessing,
    processAfterCurrent: input.processAfterCurrent,
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
