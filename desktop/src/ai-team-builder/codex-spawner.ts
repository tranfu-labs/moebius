import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  AI_TEAM_BUILDER_CODEX_IDLE_TIMEOUT_MS,
  AI_TEAM_BUILDER_CODEX_MAX_DURATION_MS,
  CODEX_PROVIDER_CONFIG,
  buildTeamBuilderExecOptions,
} from "../../../src/config.js";
import {
  run as runCodex,
  type CodexRunOptions,
  type CodexRunResult,
} from "../../../src/codex.js";
import { isValidPathSegment } from "../team-model.js";
import type {
  AiTeamBuilderDriverPort,
  AiTeamBuilderDriverRequest,
  AiTeamBuilderDriverResult,
} from "./driver.js";
import { AI_TEAM_BUILDER_DEVELOPER_INSTRUCTIONS } from "./instructions.js";
import { serializeAiTeamBuilderOutputSchema } from "./output-schema.js";

export interface AiTeamBuilderCodexSpawnerOptions {
  run?: (options: CodexRunOptions) => Promise<CodexRunResult>;
}

export class AiTeamBuilderCodexSpawner implements AiTeamBuilderDriverPort {
  private readonly run: (options: CodexRunOptions) => Promise<CodexRunResult>;

  constructor(options: AiTeamBuilderCodexSpawnerOptions = {}) {
    this.run = options.run ?? runCodex;
  }

  async execute(request: AiTeamBuilderDriverRequest): Promise<AiTeamBuilderDriverResult> {
    assertDraftId(request.draftId);
    if (request.profile.cli !== "codex") {
      return { ok: false, reason: "codex-profile-required", resumeFailed: false };
    }
    const runtimeRoot = path.join(
      path.resolve(request.dataRoot),
      ".state",
      "ai-team-builder-runtime",
      request.draftId,
    );
    const isolatedCwd = path.join(runtimeRoot, "workspace");
    const schemaPath = path.join(runtimeRoot, "output-schema.json");
    const runDir = path.join(runtimeRoot, "runs", randomUUID());
    await fs.mkdir(isolatedCwd, { recursive: true });
    await writeFileAtomically(schemaPath, serializeAiTeamBuilderOutputSchema());

    const mode = request.externalSessionId === null
      ? { kind: "full" as const }
      : { kind: "resume" as const, threadId: request.externalSessionId };
    const result = await this.run({
      prompt: request.prompt,
      runDir,
      mode,
      cwd: isolatedCwd,
      execOptions: buildTeamBuilderExecOptions({
        mode: mode.kind,
        schemaPath,
        isolatedCwd,
        developerInstructions: AI_TEAM_BUILDER_DEVELOPER_INSTRUCTIONS,
        providerConfig: CODEX_PROVIDER_CONFIG,
        model: request.profile.model,
        effort: request.profile.effort,
      }),
      idleTimeoutMs: AI_TEAM_BUILDER_CODEX_IDLE_TIMEOUT_MS,
      maxDurationMs: AI_TEAM_BUILDER_CODEX_MAX_DURATION_MS,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });

    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        resumeFailed: request.externalSessionId !== null,
      };
    }
    const externalSessionId = result.threadId ?? request.externalSessionId;
    if (externalSessionId === null) {
      return { ok: false, reason: "thread-id-missing", resumeFailed: false };
    }
    return { ok: true, finalText: result.finalText, externalSessionId };
  }
}

function assertDraftId(draftId: string): void {
  if (!isValidPathSegment(draftId) || draftId.trim() !== draftId) {
    throw new AiTeamBuilderCodexError("Invalid AI team builder draft id.");
  }
}

async function writeFileAtomically(targetPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(temporaryPath, content, "utf8");
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

export class AiTeamBuilderCodexError extends Error {
  readonly code = "AI_TEAM_BUILDER_CODEX_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "AiTeamBuilderCodexError";
  }
}
