import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import type { LocalConsoleStorePorts } from "./runtime-store-ports.js";
import type { LocalProjectCommandRuntime } from "./project-command-runtime.js";
import type { LocalSessionCreationRuntime } from "./session-creation-runtime.js";
import type { LocalSessionSettingsRuntime } from "./session-settings-runtime.js";
import type { LocalSessionReferenceRuntime } from "./session-reference-runtime.js";
import { decideTeamSnapshotLoad } from "./session-settings-plan.js";
import { decideSessionCreationProjectId } from "./session-creation-plan.js";

type ProjectPorts = ConstructorParameters<typeof LocalProjectCommandRuntime>[0];
type CreationPorts = ConstructorParameters<typeof LocalSessionCreationRuntime>[0];
type SettingsPorts = ConstructorParameters<typeof LocalSessionSettingsRuntime>[0];
type ReferencePorts = ConstructorParameters<typeof LocalSessionReferenceRuntime>[0];

export function createLocalSessionCommandWiring(input: {
  options: LocalConsoleRuntimeOptions;
  storePorts: LocalConsoleStorePorts;
  inactiveSessions: Set<string>;
  baselineCommits: Map<string, string | null>;
  now(): Date;
  nowIso(): string;
  processPending(sessionId: string): void;
  activeRunsForSession: ProjectPorts["activeRunsForSession"];
  hasActiveRun: SettingsPorts["hasActiveRun"];
  defaultProjectId(): Promise<string>;
  assertProjectDirectoryAvailable: ProjectPorts["assertDirectoryAvailable"];
  withDirectoryAvailability: ProjectPorts["withDirectoryAvailability"];
  storedProject: CreationPorts["storedProject"];
  resolvePath: ProjectPorts["resolvePath"];
  directoryAvailable: ProjectPorts["directoryAvailable"];
  readWorkspaceFacts: CreationPorts["readWorkspaceFacts"];
  readBaselineCommit: CreationPorts["readBaselineCommit"];
  invalidateWorkspaceFacts: SettingsPorts["invalidateWorkspaceFacts"];
  randomId: ReferencePorts["randomId"];
  logBaselineUnavailable: CreationPorts["logBaselineUnavailable"];
}) {
  const { options, storePorts } = input;
  const snapshot = decideTeamSnapshotLoad(options.loadAgentTeamSnapshot !== undefined);
  const attachment = decideTeamSnapshotLoad(options.attachmentManager !== undefined);
  const workspaceTimeout = decideTeamSnapshotLoad(options.workspaceGitTimeoutMs !== undefined);
  return {
    project: {
      store: options.store,
      storeCall: (label, operation) => storePorts.call(label, operation),
      nowIso: input.nowIso,
      assertDirectoryAvailable: input.assertProjectDirectoryAvailable,
      withDirectoryAvailability: input.withDirectoryAvailability,
      processPending: input.processPending,
      activeRunsForSession: input.activeRunsForSession,
      inactiveSessions: input.inactiveSessions,
      resolvePath: input.resolvePath,
      directoryAvailable: input.directoryAvailable,
    } satisfies ProjectPorts,
    creation: {
      store: options.store,
      storeCall: (label, operation) => storePorts.call(label, operation),
      createSessionId: () => `local:${input.now().toISOString()}-${Math.random().toString(36).slice(2, 8)}`,
      nowIso: input.nowIso,
      resolveProjectId: async (projectId) => {
        const decision = decideSessionCreationProjectId(projectId);
        return decision.kind === "requested" ? decision.projectId : await input.defaultProjectId();
      },
      assertProjectDirectoryAvailable: input.assertProjectDirectoryAvailable,
      storedProject: input.storedProject,
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
      processPending: input.processPending,
    } satisfies CreationPorts,
    settings: {
      store: options.store,
      storeCall: (label, operation) => storePorts.call(label, operation),
      nowIso: input.nowIso,
      ...(snapshot.kind === "load" ? { loadAgentTeamSnapshot: options.loadAgentTeamSnapshot! } : {}),
      ...(workspaceTimeout.kind === "load"
        ? { workspaceGitTimeoutMs: options.workspaceGitTimeoutMs! }
        : {}),
      hasActiveRun: input.hasActiveRun,
      inactiveSessions: input.inactiveSessions,
      processPending: input.processPending,
      readWorkspaceFacts: input.readWorkspaceFacts,
      invalidateWorkspaceFacts: input.invalidateWorkspaceFacts,
    } satisfies SettingsPorts,
    reference: {
      store: options.store,
      storeCall: (label, operation) => storePorts.call(label, operation),
      randomId: input.randomId,
    } satisfies ReferencePorts,
  };
}
