import path from "node:path";
import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import type { LocalRunLifecycleRuntime } from "./run-lifecycle-runtime.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import type { LocalRuntimeWiringContext } from "./runtime-wiring-context.js";
import type { LocalSessionContinuationRuntime } from "./session-continuation-runtime.js";
import type { LocalProjectCommandRuntime } from "./project-command-runtime.js";
import type { LocalSessionCreationRuntime } from "./session-creation-runtime.js";
import type { LocalSessionSettingsRuntime } from "./session-settings-runtime.js";
import type { LocalSessionReferenceRuntime } from "./session-reference-runtime.js";
import { planProjectSessionActiveRuns } from "./project-command-plan.js";
import { decideTeamSnapshotLoad, planSessionHasActiveRun } from "./session-settings-plan.js";
import { decideSessionCreationProjectId } from "./session-creation-plan.js";

type ProjectPorts = ConstructorParameters<typeof LocalProjectCommandRuntime>[0];
type CreationPorts = ConstructorParameters<typeof LocalSessionCreationRuntime>[0];
type SettingsPorts = ConstructorParameters<typeof LocalSessionSettingsRuntime>[0];
type ReferencePorts = ConstructorParameters<typeof LocalSessionReferenceRuntime>[0];

export function createLocalSessionCommandWiring(input: {
  options: LocalConsoleRuntimeOptions;
  context: LocalRuntimeWiringContext;
  activeRuns: LocalActiveRunRegistry;
  lifecycle: LocalRunLifecycleRuntime;
  continuation: LocalSessionContinuationRuntime;
  inactiveSessions: Set<string>;
  baselineCommits: Map<string, string | null>;
  processPending(sessionId: string): void;
  directoryAvailable: ProjectPorts["directoryAvailable"];
  readWorkspaceFacts: CreationPorts["readWorkspaceFacts"];
  readBaselineCommit: CreationPorts["readBaselineCommit"];
  invalidateWorkspaceFacts: SettingsPorts["invalidateWorkspaceFacts"];
  randomId: ReferencePorts["randomId"];
  logBaselineUnavailable: CreationPorts["logBaselineUnavailable"];
  generateSessionTitle: CreationPorts["generateSessionTitle"];
}) {
  const { context, options } = input;
  const snapshot = decideTeamSnapshotLoad(options.loadAgentTeamSnapshot !== undefined);
  const attachment = decideTeamSnapshotLoad(options.attachmentManager !== undefined);
  const workspaceTimeout = decideTeamSnapshotLoad(options.workspaceGitTimeoutMs !== undefined);
  return {
    project: {
      store: options.store,
      storeCall: (label, operation) => context.storePorts.call(label, operation),
      nowIso: context.nowIso,
      assertDirectoryAvailable: (projectId) => input.continuation.assertProjectDirectoryAvailable(projectId),
      withDirectoryAvailability: (project, knownAvailable) =>
        input.continuation.withDirectoryAvailability(project, knownAvailable),
      processPending: input.processPending,
      activeRunsForSession: (sessionId) =>
        planProjectSessionActiveRuns([...input.activeRuns.values()], sessionId),
      inactiveSessions: input.inactiveSessions,
      resolvePath: path.resolve,
      directoryAvailable: input.directoryAvailable,
    } satisfies ProjectPorts,
    creation: {
      store: options.store,
      storeCall: (label, operation) => context.storePorts.call(label, operation),
      createSessionId: () => `local:${context.now().toISOString()}-${Math.random().toString(36).slice(2, 8)}`,
      nowIso: context.nowIso,
      resolveProjectId: async (projectId) => {
        const decision = decideSessionCreationProjectId(projectId);
        return decision.kind === "requested" ? decision.projectId : await input.continuation.defaultProjectId();
      },
      assertProjectDirectoryAvailable: (projectId) => input.continuation.assertProjectDirectoryAvailable(projectId),
      storedProject: (projectId) => input.continuation.storedProject(projectId),
      ...(snapshot.kind === "load" ? { loadAgentTeamSnapshot: options.loadAgentTeamSnapshot! } : {}),
      listAgentNames: async (sessionId) =>
        (await options.listAgentFiles(sessionId)).map((agent) => agent.name),
      ...(attachment.kind === "load"
        ? {
            findDraftAttachment: async (draftKey: string, attachmentId: string) =>
              (await options.attachmentManager!.listDraft(draftKey))
                .find((candidate) => candidate.attachmentId === attachmentId),
          }
        : {}),
      readWorkspaceFacts: input.readWorkspaceFacts,
      readBaselineCommit: input.readBaselineCommit,
      logBaselineUnavailable: input.logBaselineUnavailable,
      baselineCommits: input.baselineCommits,
      generateSessionTitle: input.generateSessionTitle,
      processPending: input.processPending,
    } satisfies CreationPorts,
    settings: {
      store: options.store,
      storeCall: (label, operation) => context.storePorts.call(label, operation),
      nowIso: context.nowIso,
      ...(snapshot.kind === "load" ? { loadAgentTeamSnapshot: options.loadAgentTeamSnapshot! } : {}),
      ...(workspaceTimeout.kind === "load"
        ? { workspaceGitTimeoutMs: options.workspaceGitTimeoutMs! }
        : {}),
      hasActiveRun: (sessionId) => planSessionHasActiveRun(input.lifecycle.runsForSession(sessionId).length),
      inactiveSessions: input.inactiveSessions,
      processPending: input.processPending,
      readWorkspaceFacts: input.readWorkspaceFacts,
      invalidateWorkspaceFacts: input.invalidateWorkspaceFacts,
    } satisfies SettingsPorts,
    reference: {
      store: options.store,
      storeCall: (label, operation) => context.storePorts.call(label, operation),
      randomId: input.randomId,
    } satisfies ReferencePorts,
  };
}
