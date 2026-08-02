import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  AI_TEAM_BUILDER_CODEX_IDLE_TIMEOUT_MS,
  AI_TEAM_BUILDER_CODEX_MAX_DURATION_MS,
} from "../../../src/config.js";
import {
  runClaude,
  type ClaudeRunOptions,
} from "../../../src/claude.js";
import { isValidPathSegment } from "../team-model.js";
import type {
  AiTeamBuilderDriverPort,
  AiTeamBuilderDriverRequest,
  AiTeamBuilderDriverResult,
} from "./driver.js";
import { selectClaudeAiTeamBuilderSession } from "./driver-session-plan.js";
import { AI_TEAM_BUILDER_DEVELOPER_INSTRUCTIONS } from "./instructions.js";
import { serializeAiTeamBuilderOutputSchema } from "./output-schema.js";

const BUILDER_TOOLS = Object.freeze(["Read", "Glob", "Grep"] as const);

export interface AiTeamBuilderClaudeSpawnerOptions {
  run?: (options: ClaudeRunOptions) => ReturnType<typeof runClaude>;
}

export class AiTeamBuilderClaudeSpawner implements AiTeamBuilderDriverPort {
  private readonly run: (options: ClaudeRunOptions) => ReturnType<typeof runClaude>;

  constructor(options: AiTeamBuilderClaudeSpawnerOptions = {}) {
    this.run = options.run ?? runClaude;
  }

  async execute(request: AiTeamBuilderDriverRequest): Promise<AiTeamBuilderDriverResult> {
    assertDraftId(request.draftId);
    if (request.profile.cli !== "claude") {
      return {
        ok: false,
        reason: "claude-profile-required",
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
    const runDir = path.join(runtimeRoot, "runs", randomUUID());
    await fs.mkdir(isolatedCwd, { recursive: true });

    const mode = request.externalSessionId === null
      ? { kind: "full" as const }
      : { kind: "resume" as const, externalSessionId: request.externalSessionId };
    let observedExternalSessionId: string | null = null;
    const result = await this.run({
      prompt: `${AI_TEAM_BUILDER_DEVELOPER_INSTRUCTIONS}\n\n${request.prompt}`,
      runDir,
      cwd: isolatedCwd,
      profile: {
        cli: "claude",
        model: request.profile.model,
        effort: request.profile.effort,
      },
      mode,
      permissionMode: "dontAsk",
      extraArgs: [
        "--safe-mode",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--tools", BUILDER_TOOLS.join(","),
        "--json-schema", serializeAiTeamBuilderOutputSchema(),
      ],
      expectedInitTools: BUILDER_TOOLS,
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
      return {
        ok: false,
        reason: result.reason,
        resumeFailed: request.externalSessionId !== null,
        externalSessionId: selectClaudeAiTeamBuilderSession({
          threadId: result.threadId,
          observedExternalSessionId,
          requestedExternalSessionId: request.externalSessionId,
        }),
      };
    }
    const externalSessionId = selectClaudeAiTeamBuilderSession({
      threadId: result.threadId,
      observedExternalSessionId,
      requestedExternalSessionId: request.externalSessionId,
    });
    if (externalSessionId === null) {
      return {
        ok: false,
        reason: "session-id-missing",
        resumeFailed: false,
        externalSessionId: null,
      };
    }
    assertExternalSessionIdentity(request.externalSessionId, externalSessionId);
    return { ok: true, finalText: result.finalText, externalSessionId };
  }
}

function assertDraftId(draftId: string): void {
  if (!isValidPathSegment(draftId) || draftId.trim() !== draftId) {
    throw new AiTeamBuilderClaudeError("Invalid AI team builder draft id.");
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
    throw new AiTeamBuilderClaudeError(
      "Claude returned a different session while resuming an AI team builder draft.",
    );
  }
}

export class AiTeamBuilderClaudeError extends Error {
  readonly code = "AI_TEAM_BUILDER_CLAUDE_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "AiTeamBuilderClaudeError";
  }
}
