import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_TEAM_BUILDER_CODEX_IDLE_TIMEOUT_MS,
  AI_TEAM_BUILDER_CODEX_MAX_DURATION_MS,
} from "../../src/config.js";
import type { CodexRunOptions, CodexRunResult } from "../../src/codex.js";
import {
  AiTeamBuilderCodexSpawner,
} from "../src/ai-team-builder/codex-spawner.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

describe("AiTeamBuilderCodexSpawner", () => {
  it("starts and resumes one isolated thread with a persisted output schema", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-team-builder-spawner-"));
    temporaryRoots.push(dataRoot);
    const calls: CodexRunOptions[] = [];
    const run = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      calls.push(options);
      return {
        ok: true,
        finalText: JSON.stringify({ phase: "clarifying", question: "面向谁？" }),
        threadId: options.mode?.kind === "resume" ? null : "thread-1",
        cachedInputTokens: null,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      };
    });
    const spawner = new AiTeamBuilderCodexSpawner({ run });

    await expect(spawner.execute({
      dataRoot,
      draftId: "draft-1",
      prompt: "持续做产品发布",
      profile: { cli: "codex", model: "test-model", effort: "medium" },
      externalSessionId: null,
    })).resolves.toMatchObject({ ok: true, externalSessionId: "thread-1" });
    await expect(spawner.execute({
      dataRoot,
      draftId: "draft-1",
      prompt: "面向专业用户",
      profile: { cli: "codex", model: "test-model", effort: "medium" },
      externalSessionId: "thread-1",
    })).resolves.toMatchObject({ ok: true, externalSessionId: "thread-1" });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      mode: { kind: "full" },
      idleTimeoutMs: AI_TEAM_BUILDER_CODEX_IDLE_TIMEOUT_MS,
      maxDurationMs: AI_TEAM_BUILDER_CODEX_MAX_DURATION_MS,
    });
    expect(calls[1]).toMatchObject({
      mode: { kind: "resume", threadId: "thread-1" },
      idleTimeoutMs: AI_TEAM_BUILDER_CODEX_IDLE_TIMEOUT_MS,
      maxDurationMs: AI_TEAM_BUILDER_CODEX_MAX_DURATION_MS,
    });
    expect(calls[0]?.execOptions).not.toContain("--yolo");
    expect(calls[0]?.execOptions).toEqual(expect.arrayContaining([
      "--ignore-user-config",
      "--ignore-rules",
      "--sandbox",
      "read-only",
      "--output-schema",
      "-m",
      "test-model",
      'model_reasoning_effort="medium"',
    ]));
    expect(calls[1]?.execOptions).toEqual(expect.arrayContaining([
      "--sandbox",
      "read-only",
      "--cd",
    ]));
    expect(calls[1]?.execOptions).toContain("--skip-git-repo-check");
    expect(calls[0]?.cwd).toBe(calls[1]?.cwd);
    expect(calls[0]?.cwd).toContain(path.join(".state", "ai-team-builder-runtime", "draft-1", "workspace"));

    const schemaIndex = calls[0]?.execOptions?.indexOf("--output-schema") ?? -1;
    const schemaPath = calls[0]?.execOptions?.[schemaIndex + 1];
    expect(schemaPath).toBeTypeOf("string");
    const schema = JSON.parse(await fs.readFile(schemaPath!, "utf8")) as {
      oneOf?: unknown;
      required: string[];
      properties: { phase: { enum: string[] } };
    };
    expect(schema.oneOf).toBeUndefined();
    expect(schema.properties.phase.enum).toEqual([
      "clarifying",
      "proposal",
    ]);
    expect(schema.required).toEqual([
      "phase",
      "question",
      "team",
      "members",
      "primaryAgentSlug",
      "relayBeats",
    ]);
  });

  it("classifies resume failure without exposing runtime paths in its public result", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-team-builder-spawner-"));
    temporaryRoots.push(dataRoot);
    const run = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => ({
      ok: false,
      reason: "exit-code-1",
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));
    const spawner = new AiTeamBuilderCodexSpawner({ run });

    const result = await spawner.execute({
      dataRoot,
      draftId: "draft-2",
      prompt: "调整成员",
      profile: { cli: "codex", model: "test-model", effort: "high" },
      externalSessionId: "missing-thread",
    });

    expect(result).toEqual({ ok: false, reason: "exit-code-1", resumeFailed: true });
    expect(JSON.stringify(result)).not.toContain(dataRoot);
  });
});
