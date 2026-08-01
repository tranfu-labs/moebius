import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import type { LocalRunLifecycleRuntime } from "./run-lifecycle-runtime.js";
import type { LocalConversationWorkspaceRuntime } from "./conversation-workspace-runtime.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import { decideRuntimeCapability, planRuntimeFallback } from "./runtime-domain.js";
import type { LocalRuntimeWiringContext } from "./runtime-wiring-context.js";
import type { LocalSessionContinuationRuntime } from "./session-continuation-runtime.js";
import type { LocalSessionPresentationRuntime } from "./session-presentation-runtime.js";
import type { LocalConsoleStateQueryRuntime } from "./state-query-runtime.js";
import type { LocalConsoleRunOutputRuntime } from "./run-output-runtime.js";
import type { LocalConsoleWorkspaceQueryRuntime } from "./workspace-query-runtime.js";

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
  defaultSessionId: string;
  lastError(): string | null;
  listChildSessions: StatePorts["listChildSessions"];
  output: Pick<OutputPorts, "readOptionalTextFile" | "sessionFactLogPath" | "factReader">;
  workspace: Omit<WorkspacePorts, "readContext" | "readWorkspaceMode">;
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
      listChildSessions: input.listChildSessions,
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
      ...input.output,
      traceDataRoot: planRuntimeFallback(options.dataRoot, options.projectRoot),
    },
    workspace: {
      readContext: (sessionId) => input.conversationWorkspace.readContext(sessionId),
      readWorkspaceMode: (sessionId) => input.conversationWorkspace.readModeBestEffort(sessionId),
      ...input.workspace,
    },
  };
}
