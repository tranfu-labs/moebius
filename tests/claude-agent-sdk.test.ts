import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildClaudeAgentSdkOptions,
  CLAUDE_INTERNAL_AGENT_TOOLS,
  runClaudeAgentSdk,
} from "../src/claude-agent-sdk.js";
import { MINIMUM_CLAUDE_CLI_VERSION } from "../src/claude-cli-version.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Claude Agent SDK adapter", () => {
  it("builds ordinary and AI Team Builder profiles without exposing interactive settings", () => {
    const abortController = new AbortController();
    const mcpServer = {
      command: process.execPath,
      args: ["/tmp/moebius-managed-mcp.js"],
      env: { MOEBIUS_TEST: "1" },
      close: vi.fn(),
    };
    const ordinary = buildClaudeAgentSdkOptions({
      executablePath: "/tmp/claude",
      cwd: "/tmp/workspace",
      profile: { kind: "ordinary", model: "sonnet", effort: "high" },
      mode: { kind: "resume", externalSessionId: "session-1" },
      abortController,
      mcpServer,
    });
    const builder = buildClaudeAgentSdkOptions({
      executablePath: "/tmp/claude",
      cwd: "/tmp/workspace",
      profile: {
        kind: "ai-team-builder",
        model: "sonnet",
        effort: "medium",
        outputFormat: { type: "json_schema", schema: { type: "object" } },
      },
      mode: { kind: "full" },
      abortController,
    });

    expect(ordinary).toMatchObject({
      cwd: path.resolve("/tmp/workspace"),
      model: "sonnet",
      effort: "high",
      pathToClaudeCodeExecutable: "/tmp/claude",
      persistSession: true,
      permissionMode: "auto",
      resume: "session-1",
      disallowedTools: [...CLAUDE_INTERNAL_AGENT_TOOLS],
      mcpServers: {
        moebius_managed: {
          type: "stdio",
          command: process.execPath,
          args: ["/tmp/moebius-managed-mcp.js"],
          env: { MOEBIUS_TEST: "1" },
        },
      },
    });
    expect(ordinary).not.toHaveProperty("settingSources");
    expect(builder).toMatchObject({
      permissionMode: "dontAsk",
      settingSources: [],
      strictMcpConfig: true,
      tools: ["Read", "Glob", "Grep"],
      outputFormat: { type: "json_schema" },
    });
    expect(builder).not.toHaveProperty("disallowedTools");
  });

  it("streams one session, preserves usage, and closes the managed MCP invocation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-claude-sdk-"));
    temporaryRoots.push(root);
    const sessionId = "session-full";
    const messages = [
      sdkMessage({ type: "system", subtype: "init", session_id: sessionId }),
      sdkMessage({
        type: "assistant",
        session_id: sessionId,
        message: { content: [{ type: "text", text: "hello" }] },
      }),
      sdkMessage({
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: sessionId,
        result: "hello",
        structured_output: undefined,
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 11,
          output_tokens: 5,
          cache_creation_input_tokens: 22,
          cache_read_input_tokens: 33,
        },
        modelUsage: {},
      }),
    ];
    const query = vi.fn(() => fakeQuery(messages));
    const onProcessStarted = vi.fn();
    const onSessionStarted = vi.fn();
    const activities: SDKMessage[] = [];
    const preflight = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const result = await runClaudeAgentSdk({
      prompt: "hi",
      runDir: path.join(root, "run"),
      cwd: root,
      profile: { kind: "ordinary", model: "sonnet", effort: "high" },
      mode: { kind: "full" },
      executablePath: "/tmp/claude",
      runVersion: async () => MINIMUM_CLAUDE_CLI_VERSION,
      query,
      mcpServer: {
        command: process.execPath,
        args: ["managed-mcp.js"],
        env: {},
        preflight,
        close,
      },
      onProcessStarted,
      onSessionStarted,
      onStructuredActivity: (event) => activities.push(event),
    });

    expect(result).toMatchObject({
      ok: true,
      finalText: "hello",
      sessionId,
      usage: { cachedInputTokens: 33, totalCostUsd: 0.01 },
    });
    expect(query).toHaveBeenCalledOnce();
    expect(onProcessStarted).toHaveBeenCalledOnce();
    expect(onSessionStarted).toHaveBeenCalledOnce();
    expect(onSessionStarted).toHaveBeenCalledWith(sessionId);
    expect(activities).toHaveLength(3);
    expect(preflight).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    const stdout = await readFile(path.join(root, "run", "claude-sdk.jsonl"), "utf8");
    expect(stdout.trim().split("\n")).toHaveLength(3);
    expect(await readFile(path.join(root, "run", "claude-sdk-stderr.log"), "utf8")).toBe("");
  });

  it("fails closed on a resumed session identity mismatch and on SDK authentication errors", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-claude-sdk-failure-"));
    temporaryRoots.push(root);
    const mismatchedQuery = vi.fn(() => fakeQuery([
      sdkMessage({ type: "system", subtype: "init", session_id: "other-session" }),
    ]));
    const mismatch = await runClaudeAgentSdk({
      prompt: "resume",
      runDir: path.join(root, "mismatch"),
      cwd: root,
      profile: { kind: "ordinary", model: "sonnet", effort: "high" },
      mode: { kind: "resume", externalSessionId: "expected-session" },
      executablePath: "/tmp/claude",
      runVersion: async () => MINIMUM_CLAUDE_CLI_VERSION,
      query: mismatchedQuery,
    });
    expect(mismatch).toMatchObject({
      ok: false,
      failure: { code: "claude-resume-unavailable" },
      sessionId: null,
    });

    const auth = await runClaudeAgentSdk({
      prompt: "login",
      runDir: path.join(root, "auth"),
      cwd: root,
      profile: { kind: "ordinary", model: "sonnet", effort: "high" },
      mode: { kind: "full" },
      executablePath: "/tmp/claude",
      runVersion: async () => MINIMUM_CLAUDE_CLI_VERSION,
      query: () => fakeQuery([sdkMessage({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        session_id: "session-auth",
        errors: ["authentication failed"],
        result: "",
      })]),
    });
    expect(auth).toMatchObject({ ok: false, failure: { code: "claude-auth-required" } });
  });

  it("resumes the canonical session without creating a replacement identity", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-claude-sdk-resume-"));
    temporaryRoots.push(root);
    const sessionId = "session-resume";
    const onSessionStarted = vi.fn();
    const result = await runClaudeAgentSdk({
      prompt: "continue",
      runDir: path.join(root, "run"),
      cwd: root,
      profile: { kind: "ordinary", model: "sonnet", effort: "high" },
      mode: { kind: "resume", externalSessionId: sessionId },
      executablePath: "/tmp/claude",
      runVersion: async () => MINIMUM_CLAUDE_CLI_VERSION,
      query: () => fakeQuery([
        sdkMessage({ type: "system", subtype: "init", session_id: sessionId }),
        sdkMessage({
          type: "result",
          subtype: "success",
          is_error: false,
          session_id: sessionId,
          result: "continued",
          structured_output: undefined,
          total_cost_usd: 0,
          usage: { input_tokens: 1, output_tokens: 1 },
          modelUsage: {},
        }),
      ]),
      onSessionStarted,
    });

    expect(result).toMatchObject({ ok: true, finalText: "continued", sessionId });
    expect(onSessionStarted).toHaveBeenCalledOnce();
    expect(onSessionStarted).toHaveBeenCalledWith(sessionId);
  });

  it("does not invoke the SDK when already cancelled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-claude-sdk-cancel-"));
    temporaryRoots.push(root);
    const controller = new AbortController();
    controller.abort();
    const query = vi.fn();
    const result = await runClaudeAgentSdk({
      prompt: "cancel",
      runDir: path.join(root, "run"),
      cwd: root,
      profile: { kind: "ordinary", model: "sonnet", effort: "high" },
      mode: { kind: "full" },
      signal: controller.signal,
      executablePath: "/tmp/claude",
      runVersion: async () => MINIMUM_CLAUDE_CLI_VERSION,
      query,
    });

    expect(result).toMatchObject({ ok: false, failure: { code: "claude-cancelled" } });
    expect(query).not.toHaveBeenCalled();
  });

  it("maps the shared idle watchdog to a bounded Claude timeout", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-claude-sdk-timeout-"));
    temporaryRoots.push(root);
    let release: (() => void) | null = null;
    const close = vi.fn(() => release?.());
    const query = vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      close,
    } as unknown as Query));

    const result = await runClaudeAgentSdk({
      prompt: "hang",
      runDir: path.join(root, "run"),
      cwd: root,
      profile: { kind: "ai-team-builder", model: "sonnet", effort: "high", outputFormat: {
        type: "json_schema",
        schema: { type: "object" },
      } },
      mode: { kind: "full" },
      executablePath: "/tmp/claude",
      runVersion: async () => MINIMUM_CLAUDE_CLI_VERSION,
      query,
      idleTimeoutMs: 10,
      maxDurationMs: 1_000,
    });

    expect(result).toMatchObject({
      ok: false,
      failure: { code: "claude-timeout" },
      sessionId: null,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps the existing Claude version gate before creating an SDK query", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-claude-sdk-version-"));
    temporaryRoots.push(root);
    const query = vi.fn();
    const result = await runClaudeAgentSdk({
      prompt: "version",
      runDir: path.join(root, "run"),
      cwd: root,
      profile: { kind: "ordinary", model: "sonnet", effort: "high" },
      mode: { kind: "full" },
      executablePath: "/tmp/claude",
      runVersion: async () => "0.0.1",
      query,
    });

    expect(result).toMatchObject({
      ok: false,
      failure: { code: "claude-cli-unsupported-version", action: "update-claude" },
    });
    expect(query).not.toHaveBeenCalled();
  });
});

function sdkMessage(value: Record<string, unknown>): SDKMessage {
  return value as unknown as SDKMessage;
}

function fakeQuery(messages: readonly SDKMessage[]): Query {
  return {
    async *[Symbol.asyncIterator]() {
      yield* messages;
    },
    close: vi.fn(),
  } as unknown as Query;
}
