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
import { migrateOfficialTeamBaselines } from "./team-official-management.js";
import { createTeamRevisionIpc } from "./team-revision-ipc.js";
import {
  createDefaultAgentMergeMember,
  createOfficialTeamAutoSyncService,
  type DefaultAgentMergeMember,
  type OfficialTeamAutoSyncOutcome,
  type OfficialTeamAutoSyncService,
} from "./team-auto-sync.js";

export interface AgentRevisionWiring {
  store: AgentRevisionStore;
  defaultAgent: DefaultAgentConfigStore;
  service: ReturnType<typeof createAgentRevisionService>;
  ipc: ReturnType<typeof createTeamRevisionIpc>;
  autoSync: OfficialTeamAutoSyncService;
  /** Default-Agent merge for the GitHub upstream sync executor. */
  mergeMember: DefaultAgentMergeMember;
  /** One-time, idempotent legacy baseline migration; runs once at startup. */
  migrateBaselines(dataRoot: string): Promise<{ migratedTeamIds: string[] }>;
  /** Startup auto-sync of every official team (three-way merge per the 08-07 decision). */
  syncOfficialTeams(dataRoot: string): Promise<Record<string, OfficialTeamAutoSyncOutcome>>;
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
  const autoSync = createOfficialTeamAutoSyncService({
    revisionService: service,
    defaultAgent,
    oneShot,
    runDirRoot: path.join(input.dataRoot, ".state", "official-auto-sync"),
  });
  const mergeMember = createDefaultAgentMergeMember({
    defaultAgent,
    oneShot,
    runDirRoot: path.join(input.dataRoot, ".state", "github-auto-sync"),
    namespace: "github",
  });
  return {
    store,
    defaultAgent,
    service,
    ipc,
    autoSync,
    mergeMember,
    migrateBaselines: async (dataRoot: string) =>
      migrateOfficialTeamBaselines({ dataRoot, revisionStore: store }),
    syncOfficialTeams: async (dataRoot: string) => autoSync.runAll(dataRoot),
  };
}
