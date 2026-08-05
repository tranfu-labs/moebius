import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import type { ClaudeRunOptions } from "../src/claude.js";
import type { CodexRunOptions, CodexRunResult } from "../src/codex.js";
import type { KimiAcpRunOptions } from "../src/kimi.js";
import {
  createLocalExecutionRunner,
  type LocalExecutionEngine,
  type LocalExecutionMode,
} from "../src/local-console/execution-driver.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
const EXPECTED_DEFAULT_TOOL_TIMEOUT_MS = 7_200_000;

describe("local tool in-flight deadline", () => {
  it("resolves the exact two-hour default when the override is empty", async () => {
    const result = await runConfigProbe("");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(String(EXPECTED_DEFAULT_TOOL_TIMEOUT_MS));
  });

  it("keeps a positive environment override exact", async () => {
    const result = await runConfigProbe("123456");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("123456");
  });

  it.each(["0", "-1", "not-a-number"])("rejects an invalid environment override: %s", async (value) => {
    const result = await runConfigProbe(value);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid positive integer config value");
  });

  it.each(["codex", "claude", "kimi"] as const)(
    "passes the configured deadline through %s full and resume execution",
    async (engine) => {
      const sessionId = `${engine}-deadline-session`;
      const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
        await options.onThreadStarted?.(sessionId);
        return successResult(options.runDir, sessionId);
      });
      const runClaude = vi.fn(async (options: ClaudeRunOptions): Promise<CodexRunResult> => {
        await options.onSessionStarted?.(sessionId);
        return successResult(options.runDir, sessionId);
      });
      const runKimi = vi.fn(async (options: KimiAcpRunOptions): Promise<CodexRunResult> => {
        await options.onSessionStarted?.(sessionId);
        return successResult(options.runDir, sessionId);
      });
      const runner = createLocalExecutionRunner({ runCodex, runClaude, runKimi });
      const profile = profileFor(engine);
      const toolTimeoutMs = 123_456;
      const modes: LocalExecutionMode[] = [
        { kind: "full" },
        { kind: "resume", externalSessionId: sessionId },
      ];

      for (const mode of modes) {
        await runner({
          prompt: "run the configured tool deadline check",
          runDir: "/tmp/moebius-local-tool-deadline",
          cwd: "/tmp/moebius-local-tool-deadline-workspace",
          profile,
          mode,
          toolTimeoutMs,
        });
      }

      const calls = engine === "codex"
        ? runCodex.mock.calls.map(([options]) => options.toolTimeoutMs)
        : engine === "claude"
          ? runClaude.mock.calls.map(([options]) => options.toolTimeoutMs)
          : runKimi.mock.calls.map(([options]) => options.toolTimeoutMs);
      expect(calls).toEqual([toolTimeoutMs, toolTimeoutMs]);
    },
  );

});

async function runConfigProbe(override: string): Promise<SpawnSyncReturns<string>> {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-local-tool-deadline-config-"));
  const env = { ...process.env, MOEBIUS_DATA_ROOT: dataRoot, MOEBIUS_LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS: override };
  try {
    return spawnSync(
      process.execPath,
      [
        tsxCli,
        "-e",
        'import { LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS } from "./src/config.ts"; process.stdout.write(String(LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS));',
      ],
      { cwd: repoRoot, env, encoding: "utf8", timeout: 10_000 },
    );
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
}

function profileFor(engine: LocalExecutionEngine) {
  if (engine === "codex") return null;
  if (engine === "claude") return { cli: "claude" as const, model: "test-model", effort: "high" };
  return { cli: "kimi" as const, model: "test-model", effort: "high" };
}

function successResult(runDir: string, threadId: string): CodexRunResult {
  return {
    ok: true,
    finalText: "deadline check complete",
    threadId,
    cachedInputTokens: null,
    runDir,
    stdoutPath: path.join(runDir, "stdout.jsonl"),
    stderrPath: path.join(runDir, "stderr.log"),
  };
}
