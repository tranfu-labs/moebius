import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import type { LocalRunLifecycleRuntime } from "./run-lifecycle-runtime.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import { decideRuntimeCapability, planRuntimeFallback } from "./runtime-domain.js";
import type { LocalConsoleStorePorts } from "./runtime-store-ports.js";
import type { LocalConsoleStateQueryRuntime } from "./state-query-runtime.js";
import type { LocalConsoleRunOutputRuntime } from "./run-output-runtime.js";
import type { LocalConsoleWorkspaceQueryRuntime } from "./workspace-query-runtime.js";

type StatePorts = ConstructorParameters<typeof LocalConsoleStateQueryRuntime>[0];
type OutputPorts = ConstructorParameters<typeof LocalConsoleRunOutputRuntime>[0];
type WorkspacePorts = ConstructorParameters<typeof LocalConsoleWorkspaceQueryRuntime>[0];

export function createLocalSessionReadWiring(input: {
  options: LocalConsoleRuntimeOptions;
  storePorts: LocalConsoleStorePorts;
  activeRuns: LocalActiveRunRegistry;
  lifecycle: LocalRunLifecycleRuntime;
  defaultSessionId: string;
  lastError(): string | null;
  state: Pick<StatePorts,
    | "withDirectoryAvailability"
    | "withSessionWorkspaceContext"
    | "withRuntimeActivity"
    | "synchronizeNonContinuableRecords"
    | "stopUnsafeRunsWithUnavailableContext"
    | "listChildSessions"
    | "readWorkspaceDiff"
  >;
  output: Pick<OutputPorts, "readOptionalTextFile" | "sessionFactLogPath" | "factReader">;
  workspace: WorkspacePorts;
}): { state: StatePorts; output: OutputPorts; workspace: WorkspacePorts } {
  const { options, storePorts } = input;
  return {
    state: {
      store: options.store,
      storeCall: (label, operation) => storePorts.call(label, operation),
      defaultSessionId: input.defaultSessionId,
      projectRoot: options.projectRoot,
      lastError: input.lastError,
      ...input.state,
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
      storeCall: (label, operation) => storePorts.call(label, operation),
      activeRun: (runId) => input.activeRuns.get(runId),
      activeRunIds: (sessionId) => new Set(input.lifecycle.runsForSession(sessionId).map((run) => run.runId)),
      ...input.output,
      traceDataRoot: planRuntimeFallback(options.dataRoot, options.projectRoot),
    },
    workspace: input.workspace,
  };
}
