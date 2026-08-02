import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  AI_TEAM_BUILDER_CODEX_IDLE_TIMEOUT_MS,
  AI_TEAM_BUILDER_CODEX_MAX_DURATION_MS,
} from "../../../src/config.js";
import { runKimiAcp, type KimiAcpRunOptions } from "../../../src/kimi.js";
import { resolveKimiRuntimeHomePaths } from "../../../src/kimi-runtime-home.js";
import { isValidPathSegment } from "../team-model.js";
import type {
  AiTeamBuilderDriverPort,
  AiTeamBuilderDriverRequest,
  AiTeamBuilderDriverResult,
} from "./driver.js";
import {
  selectKimiAiTeamBuilderFailedSession,
  selectKimiAiTeamBuilderSession,
} from "./driver-session-plan.js";
import { AI_TEAM_BUILDER_DEVELOPER_INSTRUCTIONS } from "./instructions.js";

export interface AiTeamBuilderKimiSpawnerOptions {
  run?: (options: KimiAcpRunOptions) => ReturnType<typeof runKimiAcp>;
}

export class AiTeamBuilderKimiSpawner implements AiTeamBuilderDriverPort {
  private readonly run: (options: KimiAcpRunOptions) => ReturnType<typeof runKimiAcp>;

  constructor(options: AiTeamBuilderKimiSpawnerOptions = {}) {
    this.run = options.run ?? runKimiAcp;
  }

  async execute(request: AiTeamBuilderDriverRequest): Promise<AiTeamBuilderDriverResult> {
    assertDraftId(request.draftId);
    if (request.profile.cli !== "kimi") {
      return {
        ok: false,
        reason: "kimi-profile-required",
        resumeFailed: false,
        externalSessionId: request.externalSessionId,
      };
    }
    const dataRoot = path.resolve(request.dataRoot);
    const runtimeRoot = path.join(
      dataRoot,
      ".state",
      "ai-team-builder-runtime",
      request.draftId,
    );
    const isolatedCwd = path.join(runtimeRoot, "workspace");
    const runDir = path.join(runtimeRoot, "runs", randomUUID());
    await fs.mkdir(isolatedCwd, { recursive: true });
    await writeFileAtomically(
      path.join(isolatedCwd, "AGENTS.md"),
      `${AI_TEAM_BUILDER_DEVELOPER_INSTRUCTIONS}\n`,
    );

    const mode = request.externalSessionId === null
      ? { kind: "full" as const }
      : {
          kind: "resume" as const,
          externalSessionId: request.externalSessionId,
        };
    let observedExternalSessionId: string | null = null;
    const result = await this.run({
      prompt: request.prompt,
      runDir,
      cwd: isolatedCwd,
      profile: {
        cli: "kimi",
        model: request.profile.model,
        effort: request.profile.effort,
      },
      mode,
      workspaceAccess: "read-only",
      permissionMode: "default",
      runtimeHomePaths: resolveKimiRuntimeHomePaths({ dataRoot }),
      idleTimeoutMs: AI_TEAM_BUILDER_CODEX_IDLE_TIMEOUT_MS,
      maxDurationMs: AI_TEAM_BUILDER_CODEX_MAX_DURATION_MS,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      onSessionStarted: async (sessionId) => {
        assertExternalSessionIdentity(request.externalSessionId, sessionId);
        observedExternalSessionId = sessionId;
        await request.onExternalSessionStarted?.(sessionId);
      },
    });
    if (!result.ok) {
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
        reason: result.reason,
        resumeFailed: request.externalSessionId !== null,
        externalSessionId: selectKimiAiTeamBuilderFailedSession({
          observedExternalSessionId,
          requestedExternalSessionId: request.externalSessionId,
        }),
      };
    }
    const externalSessionId = selectKimiAiTeamBuilderSession({
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
        reason: "session-id-missing",
        resumeFailed: false,
        externalSessionId: null,
      };
    }
    assertExternalSessionIdentity(request.externalSessionId, externalSessionId);
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
    throw new AiTeamBuilderKimiError(
      "Kimi returned a different session while resuming an AI team builder draft.",
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
    throw new AiTeamBuilderKimiError("Invalid AI team builder draft id.");
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

export class AiTeamBuilderKimiError extends Error {
  readonly code = "AI_TEAM_BUILDER_KIMI_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "AiTeamBuilderKimiError";
  }
}
