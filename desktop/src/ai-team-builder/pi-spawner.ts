import fs from "node:fs/promises";
import path from "node:path";

import type { PiExecutionRunOptions } from "../../../src/local-console/execution-driver.js";
import type { LocalConsoleExecutionProfile } from "../../../src/local-console/types.js";
import type { CodexRunResult } from "../../../src/codex.js";
import type {
  AiTeamBuilderDriverPort,
  AiTeamBuilderDriverRequest,
  AiTeamBuilderDriverResult,
} from "./driver.js";

type PiProfile = Extract<LocalConsoleExecutionProfile, { cli: "pi" }>;
type RunPi = (input: PiExecutionRunOptions & { profile: PiProfile }) => Promise<CodexRunResult>;

export class AiTeamBuilderPiSpawner implements AiTeamBuilderDriverPort {
  constructor(private readonly runPi: RunPi) {}

  async execute(request: AiTeamBuilderDriverRequest): Promise<AiTeamBuilderDriverResult> {
    if (request.profile.cli !== "pi") {
      throw new Error("Pi team builder received a non-Pi execution profile.");
    }
    const runDir = path.join(request.dataRoot, ".state", "ai-team-builder-runs", request.draftId);
    await fs.mkdir(runDir, { recursive: true });
    let externalSessionId = request.externalSessionId;
    const result = await this.runPi({
      prompt: request.prompt,
      runDir,
      cwd: request.dataRoot,
      profile: request.profile,
      mode: externalSessionId === null
        ? { kind: "full" }
        : { kind: "resume", externalSessionId },
      signal: request.signal,
      workspaceAccess: "read-write",
      onSessionStarted: async ({ externalSessionId: observed }) => {
        externalSessionId = observed;
        await request.onExternalSessionStarted?.(observed);
      },
    });
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        resumeFailed: request.externalSessionId !== null,
        externalSessionId,
      };
    }
    if (result.threadId === null) {
      return {
        ok: false,
        reason: "Pi team builder did not report a native session.",
        resumeFailed: request.externalSessionId !== null,
        externalSessionId,
      };
    }
    return {
      ok: true,
      finalText: result.finalText,
      externalSessionId: result.threadId,
    };
  }
}
