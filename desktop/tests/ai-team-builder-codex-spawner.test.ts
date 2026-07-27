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
      await options.onThreadStarted?.("thread-1");
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
    const spawner = new AiTeamBuilderCodexSpawner({
      run,
      resolveThread: availableThread,
    });
    const onExternalSessionStarted = vi.fn(async () => {});

    await expect(spawner.execute({
      dataRoot,
      draftId: "draft-1",
      prompt: "持续做产品发布",
      profile: { cli: "codex", model: "test-model", effort: "medium" },
      externalSessionId: null,
      onExternalSessionStarted,
    })).resolves.toMatchObject({ ok: true, externalSessionId: "thread-1" });
    await expect(spawner.execute({
      dataRoot,
      draftId: "draft-1",
      prompt: "面向专业用户",
      profile: { cli: "codex", model: "test-model", effort: "medium" },
      externalSessionId: "thread-1",
      onExternalSessionStarted,
    })).resolves.toMatchObject({ ok: true, externalSessionId: "thread-1" });

    expect(calls).toHaveLength(2);
    expect(onExternalSessionStarted).toHaveBeenCalledTimes(2);
    expect(onExternalSessionStarted).toHaveBeenNthCalledWith(1, "thread-1");
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
    await expect(readInvocation(calls[0]!.runDir)).resolves.toMatchObject({
      mode: "full",
      requestedExternalSessionId: null,
      observedExternalSessionId: "thread-1",
      outcome: "succeeded",
    });
    await expect(readInvocation(calls[1]!.runDir)).resolves.toMatchObject({
      mode: "resume",
      requestedExternalSessionId: "thread-1",
      observedExternalSessionId: "thread-1",
      outcome: "succeeded",
    });

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
    const spawner = new AiTeamBuilderCodexSpawner({
      run,
      resolveThread: availableThread,
    });

    const result = await spawner.execute({
      dataRoot,
      draftId: "draft-2",
      prompt: "调整成员",
      profile: { cli: "codex", model: "test-model", effort: "high" },
      externalSessionId: "missing-thread",
    });

    expect(result).toEqual({
      ok: false,
      reason: "exit-code-1",
      resumeFailed: true,
      externalSessionId: "missing-thread",
    });
    expect(JSON.stringify(result)).not.toContain(dataRoot);
    const runRoot = path.join(
      dataRoot,
      ".state",
      "ai-team-builder-runtime",
      "draft-2",
      "runs",
    );
    const [runDir] = await fs.readdir(runRoot);
    await expect(readInvocation(path.join(runRoot, runDir!))).resolves.toMatchObject({
      mode: "resume",
      requestedExternalSessionId: "missing-thread",
      outcome: "failed",
    });
  });

  it("rejects an unavailable resume before Codex can create a replacement thread", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-team-builder-spawner-"));
    temporaryRoots.push(dataRoot);
    const run = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => ({
      ok: true,
      finalText: "replacement must not run",
      threadId: "replacement-thread",
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));
    const spawner = new AiTeamBuilderCodexSpawner({
      run,
      resolveThread: async () => ({ status: "unavailable", reason: "not-found" }),
    });

    const result = await spawner.execute({
      dataRoot,
      draftId: "draft-missing",
      prompt: "继续调整",
      profile: { cli: "codex", model: "test-model", effort: "medium" },
      externalSessionId: "missing-thread",
    });

    expect(result).toEqual({
      ok: false,
      reason: "resume-unavailable:not-found",
      resumeFailed: true,
      externalSessionId: "missing-thread",
    });
    expect(run).not.toHaveBeenCalled();
    const runRoot = path.join(
      dataRoot,
      ".state",
      "ai-team-builder-runtime",
      "draft-missing",
      "runs",
    );
    const [runDir] = await fs.readdir(runRoot);
    await expect(readInvocation(path.join(runRoot, runDir!))).resolves.toMatchObject({
      mode: "resume",
      requestedExternalSessionId: "missing-thread",
      observedExternalSessionId: null,
      outcome: "failed",
    });
  });

  it("returns the observed thread when persistence rejects thread.started", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-team-builder-spawner-"));
    temporaryRoots.push(dataRoot);
    const run = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      try {
        await options.onThreadStarted?.("thread-observed");
      } catch (error) {
        return {
          ok: false,
          reason: `thread-start-callback-failed:${
            error instanceof Error ? error.message : String(error)
          }`,
          runDir: options.runDir,
          stdoutPath: path.join(options.runDir, "stdout.jsonl"),
          stderrPath: path.join(options.runDir, "stderr.log"),
        };
      }
      throw new Error("expected persistence to reject");
    });
    const spawner = new AiTeamBuilderCodexSpawner({ run });

    const result = await spawner.execute({
      dataRoot,
      draftId: "draft-persistence-failure",
      prompt: "创建团队",
      profile: { cli: "codex", model: "test-model", effort: "medium" },
      externalSessionId: null,
      onExternalSessionStarted: async () => {
        throw new Error("draft persistence unavailable");
      },
    });

    expect(result).toEqual({
      ok: false,
      reason: "thread-start-callback-failed:draft persistence unavailable",
      resumeFailed: false,
      externalSessionId: "thread-observed",
    });
    const runRoot = path.join(
      dataRoot,
      ".state",
      "ai-team-builder-runtime",
      "draft-persistence-failure",
      "runs",
    );
    const [runDir] = await fs.readdir(runRoot);
    await expect(readInvocation(path.join(runRoot, runDir!))).resolves.toMatchObject({
      mode: "full",
      observedExternalSessionId: "thread-observed",
      outcome: "failed",
    });
  });

  it("stops a real fake Codex that replaces a resumed thread and records one failed resume", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-team-builder-spawner-"));
    temporaryRoots.push(dataRoot);
    const binDir = path.join(dataRoot, "bin");
    const markerPath = path.join(dataRoot, "model-ran");
    await fs.mkdir(binDir);
    await fs.writeFile(
      path.join(binDir, "codex"),
      `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "replacement-thread" }) + "\\n");
setTimeout(() => {
  require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "ran");
  process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "replacement output" } }) + "\\n");
}, 250);
`,
      "utf8",
    );
    await fs.chmod(path.join(binDir, "codex"), 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    try {
      const spawner = new AiTeamBuilderCodexSpawner({
        resolveThread: availableThread,
      });
      const result = await spawner.execute({
        dataRoot,
        draftId: "draft-replacement",
        prompt: "继续调整",
        profile: { cli: "codex", model: "test-model", effort: "medium" },
        externalSessionId: "requested-thread",
      });

      expect(result).toMatchObject({
        ok: false,
        resumeFailed: true,
        externalSessionId: "requested-thread",
      });
      expect(result.ok || result.reason).toBe(
        "thread-start-callback-failed:Codex returned a different thread while resuming an AI team builder draft.",
      );
      await expect(fs.access(markerPath)).rejects.toMatchObject({ code: "ENOENT" });
      const runRoot = path.join(
        dataRoot,
        ".state",
        "ai-team-builder-runtime",
        "draft-replacement",
        "runs",
      );
      const [runDir] = await fs.readdir(runRoot);
      await expect(readInvocation(path.join(runRoot, runDir!))).resolves.toMatchObject({
        mode: "resume",
        requestedExternalSessionId: "requested-thread",
        observedExternalSessionId: "replacement-thread",
        outcome: "failed",
      });
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

async function readInvocation(runDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(runDir, "invocation.json"), "utf8")) as Record<string, unknown>;
}

async function availableThread() {
  return {
    status: "available" as const,
    filePath: "/tmp/codex-sessions/rollout-thread.jsonl",
    sessionsRoot: "/tmp/codex-sessions",
    identity: {
      realPath: "/tmp/codex-sessions/rollout-thread.jsonl",
      device: 1,
      inode: 1,
      size: 1,
    },
  };
}
