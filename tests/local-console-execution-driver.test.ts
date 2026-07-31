import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { CodexRunResult } from "../src/codex.js";
import type { KimiAcpRunOptions } from "../src/kimi.js";
import {
  createLocalExecutionRunner,
  withCodexSandbox,
} from "../src/local-console/execution-driver.js";

describe("local console execution access modes", () => {
  it("replaces an existing Codex sandbox and leaves ordinary options unchanged", () => {
    expect(withCodexSandbox(["--json", "--sandbox", "workspace-write"], "read-only"))
      .toEqual(["--json", "--sandbox", "read-only"]);
    expect(withCodexSandbox(undefined, null)).toBeUndefined();
    expect(withCodexSandbox(undefined, "read-only")).toEqual(["--sandbox", "read-only"]);
  });

  it("propagates read-only and read-write access to Kimi without changing the selected profile", async () => {
    const calls: KimiAcpRunOptions[] = [];
    const kimi = vi.fn(async (options: KimiAcpRunOptions): Promise<CodexRunResult> => {
      calls.push(options);
      await options.onSessionStarted?.("kimi-analysis");
      return {
        ok: true,
        finalText: "done",
        threadId: "kimi-analysis",
        cachedInputTokens: 0,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "kimi.jsonl"),
        stderrPath: path.join(options.runDir, "kimi.stderr.log"),
      };
    });
    const runner = createLocalExecutionRunner({
      runCodex: vi.fn(),
      runKimi: kimi,
    });
    const base = {
      prompt: "analyze",
      runDir: "/tmp/run",
      cwd: "/tmp/workspace",
      profile: { cli: "kimi" as const, model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" as const },
    };
    await runner({ ...base, workspaceAccess: "read-only" });
    await runner({ ...base, workspaceAccess: "read-write" });
    expect(calls.map((call) => call.workspaceAccess)).toEqual(["read-only", "read-write"]);
    expect(calls.every((call) => call.profile.model === "kimi-for-coding")).toBe(true);
  });

  it("keeps Kimi session observation separate from execution-trace readiness", async () => {
    const observed = vi.fn();
    const traceReady = vi.fn();
    const kimi = vi.fn(async (options: KimiAcpRunOptions): Promise<CodexRunResult> => {
      await options.onSessionStarted?.("kimi-empty");
      return {
        ok: false,
        reason: "kimi-empty-response",
        failure: {
          code: "kimi-empty-response",
          message: "Kimi 没有返回可用回复。请在终端直接运行 kimi 查看详细错误，然后重试。",
        },
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "kimi.jsonl"),
        stderrPath: path.join(options.runDir, "kimi.stderr.log"),
      };
    });
    const runner = createLocalExecutionRunner({ runCodex: vi.fn(), runKimi: kimi });

    await expect(runner({
      prompt: "answer",
      runDir: "/tmp/run",
      cwd: "/tmp/workspace",
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      onSessionStarted: observed,
      onExecutionTraceReady: traceReady,
    })).resolves.toMatchObject({ ok: false, reason: "kimi-empty-response" });
    expect(observed).toHaveBeenCalledOnce();
    expect(observed).toHaveBeenCalledWith({
      engine: "kimi",
      externalSessionId: "kimi-empty",
    });
    expect(traceReady).not.toHaveBeenCalled();
  });

  it("submits a successful Kimi trace exactly once even when adapter and result both report it", async () => {
    const traceReady = vi.fn();
    const kimi = vi.fn(async (options: KimiAcpRunOptions): Promise<CodexRunResult> => {
      await options.onSessionStarted?.("kimi-success");
      await options.onExecutionTraceReady?.("kimi-success");
      return {
        ok: true,
        finalText: "done",
        completionKind: "visible-text",
        threadId: "kimi-success",
        cachedInputTokens: null,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "kimi.jsonl"),
        stderrPath: path.join(options.runDir, "kimi.stderr.log"),
      };
    });
    const runner = createLocalExecutionRunner({ runCodex: vi.fn(), runKimi: kimi });

    await runner({
      prompt: "answer",
      runDir: "/tmp/run",
      cwd: "/tmp/workspace",
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      onExecutionTraceReady: traceReady,
    });
    expect(traceReady).toHaveBeenCalledOnce();
    expect(traceReady).toHaveBeenCalledWith({
      engine: "kimi",
      externalSessionId: "kimi-success",
    });
  });
});
