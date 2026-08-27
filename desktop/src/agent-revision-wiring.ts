import path from "node:path";

import { createLocalExecutionRunner } from "../../src/local-console/execution-driver.js";
import type { LocalConsoleExecutionProfile } from "../../src/local-console/types.js";
import type { CodexRunResult } from "../../src/codex.js";
import type { PiExecutionRunOptions } from "../../src/local-console/execution-driver.js";

import { createAgentRevisionService } from "./agent-revision-service.js";
import { createAgentRevisionStore, type AgentRevisionStore } from "./agent-revision-store.js";
import {
  createAgentRevisionSummaryJob,
  type AgentRevisionOneShotPort,
  type AgentRevisionSummarySettled,
} from "./agent-revision-summary-job.js";
import {
  createDefaultAgentConfigStore,
  type DefaultAgentConfigStore,
} from "./default-agent-config-store.js";
import { createTeamRevisionIpc } from "./team-revision-ipc.js";

export interface AgentRevisionWiring {
  store: AgentRevisionStore;
  defaultAgent: DefaultAgentConfigStore;
  service: ReturnType<typeof createAgentRevisionService>;
  ipc: ReturnType<typeof createTeamRevisionIpc>;
}

/**
 * Composition of the change-1 revision/默认 Agent services. Kept out of
 * `main.ts` so the composition root stays narrow; this module assembles only
 * concrete adapters (never views), so it is not itself a composition root.
 */
export function createAgentRevisionWiring(input: {
  dataRoot: string;
  sqlitePath: string;
  runPi: (options: PiExecutionRunOptions) => Promise<CodexRunResult>;
  /** Main-process push of the summary-settled event to the renderer window(s). */
  publishSummarySettled(settled: AgentRevisionSummarySettled): void;
}): AgentRevisionWiring {
  const store = createAgentRevisionStore({ sqlitePath: input.sqlitePath });
  const defaultAgent = createDefaultAgentConfigStore({ dataRoot: input.dataRoot });
  const defaultAgentRunner = createLocalExecutionRunner({
    dataRoot: input.dataRoot,
    runPi: input.runPi,
  });
  const oneShot: AgentRevisionOneShotPort = {
    async run({ profile, prompt, runDir }) {
      const result = await defaultAgentRunner({
        prompt,
        runDir,
        cwd: runDir,
        profile: profile as LocalConsoleExecutionProfile,
        mode: { kind: "full" },
        workspaceAccess: "read-only",
        idleTimeoutMs: 60_000,
        maxDurationMs: 120_000,
      });
      return result.ok
        ? { ok: true, text: result.finalText }
        : { ok: false, reason: result.reason };
    },
  };
  const summarize = createAgentRevisionSummaryJob({
    store,
    configStore: defaultAgent,
    oneShot,
    runDirRoot: path.join(input.dataRoot, ".state", "agent-revision-summaries"),
    onSettled: (settled) => input.publishSummarySettled(settled),
  });
  const service = createAgentRevisionService({ store, summarize });
  const ipc = createTeamRevisionIpc({
    dataRoot: input.dataRoot,
    store,
    service,
    defaultAgent,
  });
  return {
    store,
    defaultAgent,
    service,
    ipc,
  };
}
