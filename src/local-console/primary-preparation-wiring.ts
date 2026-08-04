import type { LocalConsoleAgentFile } from "./agent-file.js";
import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import type { LocalRunLifecycleRuntime } from "./run-lifecycle-runtime.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import type { LocalConsoleStorePorts } from "./runtime-store-ports.js";
import type { LocalPrimaryPreparationRuntime } from "./primary-preparation-runtime.js";
import {
  decidePrimaryAgentMarkdownSource,
  decidePrimaryAttachmentPreparation,
  planPrimaryAgentContents,
} from "./primary-runtime-plan.js";
import { decideSessionTeamSnapshotRead } from "./session-team-update-plan.js";

type PrimaryPreparationPorts = ConstructorParameters<typeof LocalPrimaryPreparationRuntime>[0];

export function createLocalPrimaryPreparationPorts(input: {
  options: Pick<LocalConsoleRuntimeOptions, "store" | "attachmentManager">;
  storePorts: Pick<LocalConsoleStorePorts,
    | "call"
    | "requireRecoveryFacts"
    | "recordRunExecutionContext"
    | "recordAgentSessionLink"
  >;
  activeRuns: LocalActiveRunRegistry;
  lifecycle: LocalRunLifecycleRuntime;
  nowIso: PrimaryPreparationPorts["nowIso"];
  inactive: PrimaryPreparationPorts["inactive"];
  readAgentFile(agent: LocalConsoleAgentFile): Promise<string>;
  makeRunDir: PrimaryPreparationPorts["makeRunDir"];
  resolveWorkspace: PrimaryPreparationPorts["resolveWorkspace"];
  concurrentRecoveryWorkspace: PrimaryPreparationPorts["concurrentRecoveryWorkspace"];
  buildAnalysisContract: PrimaryPreparationPorts["buildAnalysisContract"];
  loadRecoverySnapshot: PrimaryPreparationPorts["loadRecoverySnapshot"];
  isCodexThreadAvailable: PrimaryPreparationPorts["isCodexThreadAvailable"];
  settleUnavailable: PrimaryPreparationPorts["settleUnavailable"];
}): PrimaryPreparationPorts {
  const { options, storePorts } = input;
  return {
    nowIso: input.nowIso,
    inactive: input.inactive,
    loadSelectedAgentMarkdown: async (agent) => {
      const source = decidePrimaryAgentMarkdownSource(agent.agentMarkdown);
      return source.kind === "inline" ? source.markdown : await input.readAgentFile(agent);
    },
    makeRunDir: input.makeRunDir,
    setSourceRunDir: (message, sessionId, runDir) =>
      storePorts.call("local-console-store-set-rundir", () => options.store.setRunDir({
        id: message.id,
        sessionId,
        runDir,
        now: input.nowIso(),
      })),
    resolveWorkspace: input.resolveWorkspace,
    loadAgentContents: async (agents, selected, selectedMarkdown) => {
      const fileMarkdown = new Map<string, string>();
      await Promise.all(agents.map(async (agent) => {
        const source = decidePrimaryAgentMarkdownSource(agent.agentMarkdown);
        if (source.kind === "file") fileMarkdown.set(agent.name, await input.readAgentFile(agent));
      }));
      return planPrimaryAgentContents(agents, selected.name, selectedMarkdown, fileMarkdown);
    },
    loadTeamSnapshot: async (sessionId) => ({
      empty: async () => null,
      read: async () => await options.store.listSessionAgentTeamSnapshot!(sessionId),
    })[decideSessionTeamSnapshotRead(options.store.listSessionAgentTeamSnapshot !== undefined)](),
    concurrentRecoveryWorkspace: input.concurrentRecoveryWorkspace,
    buildAnalysisContract: input.buildAnalysisContract,
    loadRecoverySnapshot: input.loadRecoverySnapshot,
    isCodexThreadAvailable: input.isCodexThreadAvailable,
    settleUnavailable: input.settleUnavailable,
    recordRunExecutionContext: (context) => storePorts.recordRunExecutionContext(context),
    recordAgentSessionLink: (link) => storePorts.recordAgentSessionLink(link),
    prepareAttachments: async (attachmentInput) => {
      const decision = decidePrimaryAttachmentPreparation(options.attachmentManager !== undefined);
      if (decision.kind === "empty") return { promptSuffix: "", imagePaths: [] };
      return await options.attachmentManager!.prepareRunAttachments(attachmentInput);
    },
    consumeRecoveryIntent: ({ sessionId, runId, intentId, mode, reason }) =>
      storePorts.call("local-console-store-consume-resume", () =>
        storePorts.requireRecoveryFacts().recordCodexResumeConsumed({
          sessionId,
          intentId,
          resumedByRunId: runId,
          mode,
          reason,
          consumedAt: input.nowIso(),
        })),
    prepareLifecycle: (runInput) => input.lifecycle.prepare(runInput),
    setActiveRun: (runId, active) => { input.activeRuns.set(runId, active); },
    recordLifecycle: (active) => input.lifecycle.record(active, "created", "created"),
  };
}
