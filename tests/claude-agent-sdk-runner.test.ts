import { describe, expect, it, vi } from "vitest";

import type {
  ClaudeAgentSdkRunOptions,
  ClaudeAgentSdkRunResult,
} from "../src/claude-agent-sdk.js";
import { createLocalClaudeAgentSdkRunner } from "../src/local-console/claude-agent-sdk-runner.js";
import { createLocalClaudeAgentSdkRuntimeWiring } from "../src/local-console/claude-agent-sdk-runtime-wiring.js";

describe("local-console Claude Agent SDK runner", () => {
  it("maps the ordinary local-console profile and preserves the canonical result", async () => {
    let captured: ClaudeAgentSdkRunOptions | null = null;
    const run = vi.fn(async (options: ClaudeAgentSdkRunOptions): Promise<ClaudeAgentSdkRunResult> => {
      captured = options;
      await options.onProcessStarted?.();
      await options.onSessionStarted?.("claude-session");
      return {
        ok: true,
        finalText: "done",
        structuredOutput: undefined,
        sessionId: "claude-session",
        usage: {
          usage: {} as never,
          modelUsage: {} as never,
          totalCostUsd: 0.02,
          cachedInputTokens: 17,
        },
        runDir: "/tmp/run",
        stdoutPath: "/tmp/run/claude-sdk.jsonl",
        stderrPath: "/tmp/run/claude-sdk-stderr.log",
      };
    });
    const onProcessStarted = vi.fn();
    const onSessionStarted = vi.fn();
    const mcpServer = { command: "/usr/bin/node", args: [], env: {}, close: vi.fn() };
    const runner = createLocalClaudeAgentSdkRunner({ run });

    const result = await runner({
      prompt: "work",
      runDir: "/tmp/run",
      cwd: "/tmp/workspace",
      profile: { cli: "claude", model: "sonnet", effort: "high" },
      mode: { kind: "resume", externalSessionId: "claude-session" },
      permissionMode: "auto",
      mcpServer,
      onProcessStarted,
      onSessionStarted,
    });

    expect(captured).toMatchObject({
      prompt: "work",
      cwd: "/tmp/workspace",
      mode: { kind: "resume", externalSessionId: "claude-session" },
      profile: { kind: "ordinary", model: "sonnet", effort: "high", permissionMode: "auto" },
      mcpServer,
      closeMcpServer: false,
    });
    expect(result).toMatchObject({
      ok: true,
      finalText: "done",
      threadId: "claude-session",
      cachedInputTokens: 17,
      terminal: { kind: "completed", externalSessionId: "claude-session" },
    });
    expect(onProcessStarted).toHaveBeenCalledOnce();
    expect(onSessionStarted).toHaveBeenCalledWith("claude-session");
  });

  it("maps SDK cancellation and provider failures to the existing execution contract", async () => {
    const cancelled = createLocalClaudeAgentSdkRunner({
      run: async () => ({
        ok: false,
        reason: "Claude 执行已取消。",
        failure: { code: "claude-cancelled", message: "Claude 执行已取消。" },
        sessionId: "claude-session",
        partialText: "partial",
        runDir: "/tmp/run",
        stdoutPath: "/tmp/run/out",
        stderrPath: "/tmp/run/err",
      }),
    });
    const failed = createLocalClaudeAgentSdkRunner({
      run: async () => ({
        ok: false,
        reason: "Claude Code 尚未登录。",
        failure: { code: "claude-auth-required", message: "Claude Code 尚未登录。" },
        sessionId: null,
        partialText: "",
        runDir: "/tmp/run",
        stdoutPath: "/tmp/run/out",
        stderrPath: "/tmp/run/err",
      }),
    });
    const input = {
      prompt: "work",
      runDir: "/tmp/run",
      cwd: "/tmp/workspace",
      profile: { cli: "claude" as const, model: "sonnet", effort: "high" },
      mode: { kind: "full" as const },
    };

    expect(await cancelled(input)).toMatchObject({
      ok: false,
      reason: "claude-cancelled",
      threadId: "claude-session",
      terminal: { kind: "interrupted", actor: "user", partialText: "partial" },
    });
    expect(await failed(input)).toMatchObject({
      ok: false,
      reason: "claude-auth-required",
      failure: { code: "claude-auth-required" },
      terminal: { kind: "auth", safeCode: "claude-auth-required" },
    });
  });

  it("selects the SDK runner for the default local-console composition", async () => {
    const wiring = createLocalClaudeAgentSdkRuntimeWiring({
      hasCustomClaudeRunner: false,
      hasCustomExecutionRunner: false,
    });

    expect(wiring.runClaude).toEqual(expect.any(Function));
    expect(wiring.claudeOwnsManagedProcess).toBe(false);
    expect(wiring.claudeReportsProcessStart).toBe(true);
    await wiring.close();
  });
});
