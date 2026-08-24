import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import type { LocalRunLifecycleRuntime } from "./run-lifecycle-runtime.js";
import type { LocalConversationWorkspaceRuntime } from "./conversation-workspace-runtime.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import { decideRuntimeCapability, planRuntimeFallback } from "./runtime-domain.js";
import type { LocalRuntimeWiringContext } from "./runtime-wiring-context.js";
import type { LocalRuntimeAdapters } from "./runtime-adapters.js";
import type { LocalSessionFactWritingStore } from "./runtime-store-ports.js";
import type { LocalSessionContinuationRuntime } from "./session-continuation-runtime.js";
import type { LocalSessionPresentationRuntime } from "./session-presentation-runtime.js";
import type { LocalConsoleStateQueryRuntime } from "./state-query-runtime.js";
import type { LocalConsoleRunOutputRuntime } from "./run-output-runtime.js";
import type { LocalConsoleWorkspaceQueryRuntime } from "./workspace-query-runtime.js";
import type { LocalClaudeTerminalTraceStore } from "./claude-terminal-trace-store.js";

type StatePorts = ConstructorParameters<typeof LocalConsoleStateQueryRuntime>[0];
type OutputPorts = ConstructorParameters<typeof LocalConsoleRunOutputRuntime>[0];
type WorkspacePorts = ConstructorParameters<typeof LocalConsoleWorkspaceQueryRuntime>[0];

export function createLocalSessionReadWiring(input: {
  options: LocalConsoleRuntimeOptions;
  context: LocalRuntimeWiringContext;
  activeRuns: LocalActiveRunRegistry;
  lifecycle: LocalRunLifecycleRuntime;
  continuation: LocalSessionContinuationRuntime;
  presentation: LocalSessionPresentationRuntime;
  conversationWorkspace: LocalConversationWorkspaceRuntime;
  adapters: LocalRuntimeAdapters;
  defaultSessionId: string;
  lastError(): string | null;
  traceStore: LocalClaudeTerminalTraceStore;
}): { state: StatePorts; output: OutputPorts; workspace: WorkspacePorts } {
  const { context, options } = input;
  return {
    state: {
      store: options.store,
      storeCall: (label, operation) => context.storePorts.call(label, operation),
      defaultSessionId: input.defaultSessionId,
      projectRoot: options.projectRoot,
      lastError: input.lastError,
      withDirectoryAvailability: (project) => input.continuation.withDirectoryAvailability(project),
      withSessionWorkspaceContext: (project) => input.presentation.withSessionWorkspaceContext(project),
      withRuntimeActivity: (project) => input.presentation.withRuntimeActivity(project),
      synchronizeNonContinuableRecords: (projects) => input.presentation.synchronizeNonContinuableRecords(projects),
      stopUnsafeRunsWithUnavailableContext: (projects) => input.presentation.stopUnsafeRunsWithUnavailableContext(projects),
      listChildSessions: (parentSessionId) => context.storePorts.call(
        "local-console-store-list-child-sessions",
        () => input.adapters.listChildSessions(parentSessionId),
      ),
      readWorkspaceDiff: (sessionId) => input.conversationWorkspace.readDiff(sessionId),
      primaryRunId: (sessionId) => planRuntimeFallback(
        input.lifecycle.runForLane(sessionId, "primary")?.runId,
        null as string | null,
      ),
      activeRunSnapshots: (sessionId) => input.lifecycle.snapshots(sessionId),
      loadTeamSnapshot: (sessionId) => {
        const decision = decideRuntimeCapability(options.store.listSessionAgentTeamSnapshot);
        return decision.kind === "unavailable"
          ? Promise.resolve(null)
          : decision.capability.call(options.store, sessionId);
      },
    },
    output: {
      store: options.store,
      storeCall: (label, operation) => context.storePorts.call(label, operation),
      activeRun: (runId) => input.activeRuns.get(runId),
      activeRunIds: (sessionId) => new Set(input.lifecycle.runsForSession(sessionId).map((run) => run.runId)),
      readOptionalTextFile: input.adapters.readOptionalTextFile,
      sessionFactLogPath: (sessionId) => {
        const store = options.store as Partial<LocalSessionFactWritingStore>;
        const capability = decideRuntimeCapability(store.getSessionFactLogPath);
        if (capability.kind === "unavailable") {
          throw new Error("local console store does not provide the session fact log path");
        }
        return capability.capability.call(options.store, sessionId);
      },
      factReader: input.adapters.factReader,
      traceReader: input.adapters.traceReader,
      traceDataRoot: planRuntimeFallback(options.dataRoot, options.projectRoot),
      traceStore: input.traceStore,
    },
    workspace: {
      readContext: (sessionId) => input.conversationWorkspace.readContext(sessionId),
      readWorkspaceMode: (sessionId) => input.conversationWorkspace.readModeBestEffort(sessionId),
      readDiff: input.adapters.readDiff,
      listFiles: input.adapters.listFiles,
      readDiffFile: input.adapters.readDiffFile,
      readWorkspaceFile: input.adapters.readWorkspaceFile,
      readFileReference: input.adapters.readFileReference,
      readAgentImageSource: input.adapters.readAgentImageSource,
      log: input.adapters.report,
    },
  };
}
