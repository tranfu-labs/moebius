import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { CodexRunResult } from "../src/codex.js";
import type { KimiAcpRunOptions } from "../src/kimi.js";
import type { ClaudeRunOptions } from "../src/claude.js";
import type { CodexRunOptions } from "../src/codex.js";
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

  it.each(["codex", "claude", "kimi"] as const)("injects one invocation-scoped MCP into %s and revokes it after the turn", async (engine) => {
    const close = vi.fn();
    const createManagedProcessMcp = vi.fn(() => ({
      command: "/usr/bin/node",
      args: ["/tmp/managed-bridge.js", "/tmp/managed.sock"],
      env: { MOEBIUS_MANAGED_PROCESS_CAPABILITY: "secret-token" },
      close,
    }));
    let observed: CodexRunOptions | ClaudeRunOptions | KimiAcpRunOptions | null = null;
    const result = (runDir: string): CodexRunResult => ({
      ok: true,
      finalText: "done",
      threadId: `${engine}-session`,
      cachedInputTokens: null,
      runDir,
      stdoutPath: path.join(runDir, "out"),
      stderrPath: path.join(runDir, "err"),
    });
    const runner = createLocalExecutionRunner({
      createManagedProcessMcp,
      runCodex: vi.fn(async (options) => {
        observed = options;
        await options.onThreadStarted?.("codex-session");
        return result(options.runDir);
      }),
      runClaude: vi.fn(async (options) => {
        observed = options;
        await options.onSessionStarted?.("claude-session");
        return result(options.runDir);
      }),
      runKimi: vi.fn(async (options) => {
        observed = options;
        await options.onSessionStarted?.("kimi-session");
        return result(options.runDir);
      }),
    });
    await runner({
      prompt: "start a service",
      runDir: "/tmp/run",
      cwd: "/tmp/workspace",
      profile: engine === "codex" ? null : { cli: engine, model: "model", effort: "high" },
      mode: { kind: "full" },
      managedProcess: { sessionId: "session-1", providerRunId: "run-1" },
    });
    expect(createManagedProcessMcp).toHaveBeenCalledWith({ sessionId: "session-1", providerRunId: "run-1", workspaceRoot: "/tmp/workspace" });
    expect(observed).not.toBeNull();
    if (engine === "codex") {
      const execOptions = (observed as unknown as CodexRunOptions).execOptions;
      expect(execOptions).toContain("--json");
      expect(execOptions?.join(" ")).toContain("mcp_servers.moebius_managed.command");
      expect(execOptions?.join(" ")).toContain("mcp_servers.moebius_managed.env");
      expect(execOptions?.join(" ")).toContain("MOEBIUS_MANAGED_PROCESS_CAPABILITY");
      expect((observed as unknown as CodexRunOptions).extraEnv).toBeUndefined();
    } else {
      expect((observed as unknown as ClaudeRunOptions | KimiAcpRunOptions).mcpServer?.command).toBe("/usr/bin/node");
    }
    expect(close).toHaveBeenCalledOnce();
  });

  it("fails before provider spawn when MCP injection cannot be created", async () => {
    const codex = vi.fn();
    const runner = createLocalExecutionRunner({
      runCodex: codex,
      createManagedProcessMcp: () => { throw new Error("mcp injection failed"); },
    });
    await expect(runner({
      prompt: "start",
      runDir: "/tmp/run",
      cwd: "/tmp/workspace",
      profile: null,
      mode: { kind: "full" },
      managedProcess: { sessionId: "s", providerRunId: "r" },
    })).rejects.toThrow("mcp injection failed");
    expect(codex).not.toHaveBeenCalled();
  });

  it.each(["codex", "claude", "kimi"] as const)("revokes the capability and fails before %s spawn when MCP preflight cannot discover tools", async (engine) => {
    const provider = vi.fn();
    const close = vi.fn();
    const runner = createLocalExecutionRunner({
      runCodex: provider,
      runClaude: provider,
      runKimi: provider,
      createManagedProcessMcp: () => ({
        command: "/missing/bridge",
        args: [],
        env: {},
        preflight: async () => { throw new Error("managed-process MCP tools were not discoverable"); },
        close,
      }),
    });
    await expect(runner({
      prompt: "start without shell fallback",
      runDir: "/tmp/run",
      cwd: "/tmp/workspace",
      profile: engine === "codex" ? null : { cli: engine, model: "model", effort: "high" },
      mode: { kind: "full" },
      managedProcess: { sessionId: "s", providerRunId: "r" },
    })).rejects.toThrow("tools were not discoverable");
    expect(provider).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
