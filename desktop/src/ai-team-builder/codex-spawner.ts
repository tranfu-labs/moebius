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
import {
  resolveCodexRollout,
  type CodexRolloutResolution,
} from "../../../src/codex-rollout.js";
import { isValidPathSegment } from "../team-model.js";
import type {
  AiTeamBuilderDriverPort,
  AiTeamBuilderDriverRequest,
  AiTeamBuilderDriverResult,
} from "./driver.js";
import {
  selectCodexAiTeamBuilderFailedSession,
  selectCodexAiTeamBuilderFailureResponseSession,
  selectCodexAiTeamBuilderSession,
} from "./driver-session-plan.js";
import { AI_TEAM_BUILDER_DEVELOPER_INSTRUCTIONS } from "./instructions.js";
import { serializeAiTeamBuilderOutputSchema } from "./output-schema.js";

export interface AiTeamBuilderCodexSpawnerOptions {
  run?: (options: CodexRunOptions) => Promise<CodexRunResult>;
  resolveThread?: (threadId: string) => Promise<CodexRolloutResolution>;
}

export class AiTeamBuilderCodexSpawner implements AiTeamBuilderDriverPort {
  private readonly run: (options: CodexRunOptions) => Promise<CodexRunResult>;
  private readonly resolveThread: (threadId: string) => Promise<CodexRolloutResolution>;

  constructor(options: AiTeamBuilderCodexSpawnerOptions = {}) {
    this.run = options.run ?? runCodex;
    this.resolveThread = options.resolveThread ?? resolveCodexRollout;
  }

  async execute(request: AiTeamBuilderDriverRequest): Promise<AiTeamBuilderDriverResult> {
    assertDraftId(request.draftId);
    if (request.profile.cli !== "codex") {
      return {
        ok: false,
        reason: "codex-profile-required",
        resumeFailed: false,
        externalSessionId: request.externalSessionId,
      };
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
    let observedExternalSessionId: string | null = null;
    if (mode.kind === "resume") {
      let resolution: CodexRolloutResolution;
      try {
        resolution = await this.resolveThread(mode.threadId);
      } catch (error) {
        await writeInvocationManifest(runDir, {
          version: 1,
          identityType: "ai-team-builder-draft",
          mode: mode.kind,
          requestedExternalSessionId: request.externalSessionId,
          observedExternalSessionId,
          outcome: "failed",
        });
        return {
          ok: false,
          reason: `resume-unavailable:preflight-failed:${formatError(error)}`,
          resumeFailed: true,
          externalSessionId: request.externalSessionId,
        };
      }
      if (resolution.status === "unavailable") {
        await writeInvocationManifest(runDir, {
          version: 1,
          identityType: "ai-team-builder-draft",
          mode: mode.kind,
          requestedExternalSessionId: request.externalSessionId,
          observedExternalSessionId,
          outcome: "failed",
        });
        return {
          ok: false,
          reason: `resume-unavailable:${resolution.reason}`,
          resumeFailed: true,
          externalSessionId: request.externalSessionId,
        };
      }
    }

    let result: CodexRunResult;
    try {
      result = await this.run({
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
        onThreadStarted: async (threadId) => {
          observedExternalSessionId = threadId;
          assertExternalSessionIdentity(request.externalSessionId, threadId);
          await request.onExternalSessionStarted?.(threadId);
        },
      });
    } catch (error) {
      await writeInvocationManifest(runDir, {
        version: 1,
        identityType: "ai-team-builder-draft",
        mode: mode.kind,
        requestedExternalSessionId: request.externalSessionId,
        observedExternalSessionId,
        outcome: "failed",
      });
      return {
        ok: false,
        reason: mode.kind === "resume"
          ? `resume-unavailable:${formatError(error)}`
          : `provider-run-failed:${formatError(error)}`,
        resumeFailed: mode.kind === "resume",
        externalSessionId: mode.kind === "resume"
          ? request.externalSessionId
          : observedExternalSessionId,
      };
    }

    if (!result.ok) {
      const failedObservedExternalSessionId = selectCodexAiTeamBuilderFailedSession({
        observedExternalSessionId,
        threadId: result.threadId,
      });
      await writeInvocationManifest(runDir, {
        version: 1,
        identityType: "ai-team-builder-draft",
        mode: mode.kind,
        requestedExternalSessionId: request.externalSessionId,
        observedExternalSessionId: failedObservedExternalSessionId,
        outcome: "failed",
      });
      return {
        ok: false,
        reason: result.reason,
        resumeFailed: request.externalSessionId !== null,
        externalSessionId: selectCodexAiTeamBuilderFailureResponseSession({
          requestedExternalSessionId: request.externalSessionId,
          failedObservedExternalSessionId,
        }),
      };
    }
    const externalSessionId = selectCodexAiTeamBuilderSession({
      threadId: result.threadId,
      observedExternalSessionId,
      requestedExternalSessionId: request.externalSessionId,
    });
    if (externalSessionId === null) {
      await writeInvocationManifest(runDir, {
        version: 1,
        identityType: "ai-team-builder-draft",
        mode: mode.kind,
        requestedExternalSessionId: request.externalSessionId,
        observedExternalSessionId,
        outcome: "failed",
      });
      return {
        ok: false,
        reason: "thread-id-missing",
        resumeFailed: false,
        externalSessionId: null,
      };
    }
    try {
      assertExternalSessionIdentity(request.externalSessionId, externalSessionId);
    } catch (error) {
      await writeInvocationManifest(runDir, {
        version: 1,
        identityType: "ai-team-builder-draft",
        mode: mode.kind,
        requestedExternalSessionId: request.externalSessionId,
        observedExternalSessionId: externalSessionId,
        outcome: "failed",
      });
      return {
        ok: false,
        reason: `resume-unavailable:${formatError(error)}`,
        resumeFailed: mode.kind === "resume",
        externalSessionId: request.externalSessionId,
      };
    }
    await writeInvocationManifest(runDir, {
      version: 1,
      identityType: "ai-team-builder-draft",
      mode: mode.kind,
      requestedExternalSessionId: request.externalSessionId,
      observedExternalSessionId: externalSessionId,
      outcome: "succeeded",
    });
    return { ok: true, finalText: result.finalText, externalSessionId };
  }
}

function assertExternalSessionIdentity(
  requestedExternalSessionId: string | null,
  observedExternalSessionId: string,
): void {
  if (
    requestedExternalSessionId !== null
    && requestedExternalSessionId !== observedExternalSessionId
  ) {
    throw new AiTeamBuilderCodexError(
      "Codex returned a different thread while resuming an AI team builder draft.",
    );
  }
}

async function writeInvocationManifest(
  runDir: string,
  manifest: {
    version: 1;
    identityType: "ai-team-builder-draft";
    mode: "full" | "resume";
    requestedExternalSessionId: string | null;
    observedExternalSessionId: string | null;
    outcome: "succeeded" | "failed";
  },
): Promise<void> {
  await writeFileAtomically(
    path.join(runDir, "invocation.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
