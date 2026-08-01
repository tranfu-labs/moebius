import type { LocalConsoleAgentFile } from "./agent-file.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import type { LocalConsoleStorePorts } from "./runtime-store-ports.js";
import type { LocalWorkerPreparationRuntime } from "./worker-preparation-runtime.js";
import {
  decideWorkerAgentMarkdownSource,
  decideWorkerAttachmentPreparation,
  decideWorkerDetachedCapability,
  planWorkerAgentContents,
} from "./worker-runtime-plan.js";

type WorkerPreparationPorts = ConstructorParameters<typeof LocalWorkerPreparationRuntime>[0];

export function createLocalWorkerPreparationPorts(input: {
  options: Pick<LocalConsoleRuntimeOptions, "store" | "attachmentManager">;
  storePorts: Pick<LocalConsoleStorePorts,
    | "call"
    | "recoveryFacts"
    | "requireRecoveryFacts"
    | "recordRunExecutionContext"
    | "recordAgentSessionLink"
  >;
  nowIso: WorkerPreparationPorts["nowIso"];
  stopping: WorkerPreparationPorts["stopping"];
  releaseClaim: WorkerPreparationPorts["releaseClaim"];
  sessionSummary: WorkerPreparationPorts["sessionSummary"];
  makeRunDir: WorkerPreparationPorts["makeRunDir"];
  resolveWorkspace: WorkerPreparationPorts["resolveWorkspace"];
  readAgentFile(agent: LocalConsoleAgentFile): Promise<string>;
  loadRecoverySnapshot: WorkerPreparationPorts["loadRecoverySnapshot"];
  isCodexThreadAvailable: WorkerPreparationPorts["isCodexThreadAvailable"];
  settleUnavailable: WorkerPreparationPorts["settleUnavailable"];
  prepareLifecycle: WorkerPreparationPorts["prepareLifecycle"];
  setActiveRun: WorkerPreparationPorts["setActiveRun"];
  recordLifecycle: WorkerPreparationPorts["recordLifecycle"];
}): WorkerPreparationPorts {
  const { options, storePorts } = input;
  return {
    nowIso: input.nowIso,
    stopping: input.stopping,
    releaseClaim: input.releaseClaim,
    sessionSummary: input.sessionSummary,
    makeRunDir: input.makeRunDir,
    setSourceRunDir: (message, sessionId, runDir) =>
      storePorts.call("local-console-store-set-worker-source-rundir", () => options.store.setRunDir({
        id: message.id,
        sessionId,
        runDir,
        now: input.nowIso(),
      })),
    resolveWorkspace: input.resolveWorkspace,
    loadSelectedAgentMarkdown: async (agent) => {
      const source = decideWorkerAgentMarkdownSource(agent.agentMarkdown);
      return source.kind === "inline" ? source.markdown : await input.readAgentFile(agent);
    },
    loadAgentContents: async (agents, selected, selectedMarkdown) => {
      const fileMarkdown = new Map<string, string>();
      await Promise.all(agents.map(async (agent) => {
        const source = decideWorkerAgentMarkdownSource(agent.agentMarkdown);
        if (source.kind === "file") fileMarkdown.set(agent.name, await input.readAgentFile(agent));
      }));
      return planWorkerAgentContents(agents, selected.name, selectedMarkdown, fileMarkdown);
    },
    loadRecoverySnapshot: input.loadRecoverySnapshot,
    isCodexThreadAvailable: input.isCodexThreadAvailable,
    settleUnavailable: input.settleUnavailable,
    recordRunExecutionContext: (context) => storePorts.recordRunExecutionContext(context),
    recordAgentSessionLink: (link) => storePorts.recordAgentSessionLink(link),
    prepareAttachments: async (attachmentInput) => {
      const preparation = decideWorkerAttachmentPreparation(options.attachmentManager !== undefined);
      if (preparation.kind === "empty") return { promptSuffix: "", imagePaths: [] };
      return await options.attachmentManager!.prepareRunAttachments(attachmentInput);
    },
    consumeRecoveryIntent: ({ sessionId, runId, intentId, mode, reason }) =>
      storePorts.call("local-console-store-consume-worker-resume", () =>
        storePorts.requireRecoveryFacts().recordCodexResumeConsumed({
          sessionId,
          intentId,
          resumedByRunId: runId,
          mode,
          reason,
          consumedAt: input.nowIso(),
        })),
    recordDetachedStarted: (workerInput, runDir) => {
      const record = options.store.recordDetachedRunStarted;
      const capability = decideWorkerDetachedCapability(record !== undefined);
      if (capability.kind === "missing") {
        throw new Error("local console detached run persistence capability unavailable");
      }
      return storePorts.call("local-console-store-record-worker-started", () => record!.call(options.store, {
        sessionId: workerInput.sessionId,
        role: workerInput.role,
        runId: workerInput.runId,
        runDir,
        now: input.nowIso(),
      }));
    },
    prepareLifecycle: input.prepareLifecycle,
    setActiveRun: input.setActiveRun,
    recordLifecycle: input.recordLifecycle,
  };
}
