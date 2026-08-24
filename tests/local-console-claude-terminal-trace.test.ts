import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClaudeRunOptions } from "../src/claude.js";
import type { CodexRunResult } from "../src/codex.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../src/local-console/start.js";
import { waitForValue } from "../src/testing/wait.js";

const roots: string[] = [];
const servers: StartedLocalConsoleServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => await server.close()));
  await Promise.all(roots.splice(0).map(async (root) => await fs.rm(root, { recursive: true, force: true })));
});

describe("Claude terminal trace HTTP boundary", () => {
  it("forwards ordered raw PTY bytes only while the matching Claude run is active", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-claude-terminal-trace-"));
    roots.push(root);
    const pending = { complete: null as ((result: CodexRunResult) => void) | null };
    let providerRunDir: string | null = null;
    const selectNativePrompt = vi.fn(() => ({ kind: "accepted" as const }));
    const runClaude = vi.fn(async (options: ClaudeRunOptions): Promise<CodexRunResult> => {
      providerRunDir = options.runDir;
      await options.onSessionStarted?.("11111111-1111-4111-8111-111111111111");
      options.onNativePrompt?.({
        sessionId: "11111111-1111-4111-8111-111111111111",
        decisionId: "decision-1",
        options: [
          { number: 1, label: "Keep the change", raw: "1. Keep the change" },
          { number: 2, label: "Revert the change", raw: "2. Revert the change" },
        ],
      });
      options.onTerminalData?.("\u001b[2JClaude Code\r\n");
      options.onTerminalData?.(new Uint8Array([0xff, 0x00, 0x1b]));
      return await new Promise<CodexRunResult>((resolve) => {
        pending.complete = resolve;
        options.signal?.addEventListener("abort", () => resolve(cancelledResult(options.runDir)), { once: true });
      });
    });
    const server = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      listAgentFiles: async () => [],
      loadAgentTeamSnapshot: async () => ({
        team: {
          ownership: "user",
          id: "development",
          name: "Development",
          description: null,
          primaryAgentSlug: "dev",
        },
        members: [{
          name: "dev",
          agentMarkdown: "# Dev\n\nHandle the task.",
          executionProfile: { cli: "claude", model: "sonnet", effort: "high" },
        }],
      }),
      runCodex: vi.fn(),
      runClaude,
      selectClaudeNativePrompt: selectNativePrompt,
      enableSessionTitleGeneration: false,
    });
    servers.push(server);
    await server.runtime.switchSessionTeam({
      sessionId: "default",
      agentTeamOwnership: "user",
      agentTeamId: "development",
    });

    const message = await fetch(new URL("/api/local-console/sessions/default/messages", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "@dev show the live terminal" }),
    });
    expect(message.status).toBe(202);

    const active = await waitForValue(async () => {
      const response = await fetch(new URL("/api/local-console/state?sessionId=default", server.url));
      const state = await response.json() as {
        activeRuns: Array<{ runId: string; engine?: string; nativePromptDecision?: unknown }>;
      };
      const active = state.activeRuns.find((run) => run.engine === "claude");
      return active?.nativePromptDecision === undefined || active.nativePromptDecision === null
        ? undefined
        : active;
    }, {
      describe: "active Claude run with a raw terminal trace",
      kind: "io",
      snapshot: () => ({ runClaudeCalls: runClaude.mock.calls.length }),
    });
    expect(active).toMatchObject({
      nativePromptDecision: {
        sessionId: "11111111-1111-4111-8111-111111111111",
        decisionId: "decision-1",
        options: [
          { number: 1, label: "Keep the change", raw: "1. Keep the change" },
          { number: 2, label: "Revert the change", raw: "2. Revert the change" },
        ],
      },
    });
    expect(server.runtime.selectClaudeNativePrompt({
      sessionId: "11111111-1111-4111-8111-111111111111",
      decisionId: "decision-1",
      optionNumber: 2,
    })).toEqual({ kind: "accepted" });
    expect(selectNativePrompt).toHaveBeenCalledWith({
      sessionId: "11111111-1111-4111-8111-111111111111",
      decisionId: "decision-1",
      optionNumber: 2,
    });
    const afterSelection = await fetch(new URL("/api/local-console/state?sessionId=default", server.url));
    await expect(afterSelection.json()).resolves.toMatchObject({
      activeRuns: [{ runId: active.runId, nativePromptDecision: null }],
    });

    const trace = await fetch(new URL(
      `/api/local-console/sessions/default/runs/${encodeURIComponent(active.runId)}/claude-terminal`,
      server.url,
    ));
    expect(trace.status).toBe(200);
    await expect(trace.json()).resolves.toEqual({
      sessionId: "default",
      runId: active.runId,
      chunks: [
        { cursor: 0, dataBase64: Buffer.from("\u001b[2JClaude Code\r\n").toString("base64") },
        { cursor: 1, dataBase64: Buffer.from([0xff, 0x00, 0x1b]).toString("base64") },
      ],
      nextCursor: 2,
      bytesObserved: 20,
      bytesRetained: 20,
      incomplete: false,
    });

    const append = await fetch(new URL(
      `/api/local-console/sessions/default/runs/${encodeURIComponent(active.runId)}/claude-terminal?cursor=1`,
      server.url,
    ));
    await expect(append.json()).resolves.toMatchObject({
      chunks: [{ cursor: 1, dataBase64: Buffer.from([0xff, 0x00, 0x1b]).toString("base64") }],
      nextCursor: 2,
    });

    const invalid = await fetch(new URL(
      `/api/local-console/sessions/default/runs/${encodeURIComponent(active.runId)}/claude-terminal?cursor=3`,
      server.url,
    ));
    expect(invalid.status).toBe(409);
    await expect(invalid.json()).resolves.toMatchObject({ code: "CLAUDE_TERMINAL_CURSOR_INVALID" });

    const wrongSession = await fetch(new URL(
      `/api/local-console/sessions/other/runs/${encodeURIComponent(active.runId)}/claude-terminal`,
      server.url,
    ));
    expect(wrongSession.status).toBe(404);
    await expect(wrongSession.json()).resolves.toMatchObject({ code: "CLAUDE_TERMINAL_TRACE_UNAVAILABLE" });

    const complete = pending.complete;
    if (complete === null) throw new Error("Claude run did not begin");
    if (providerRunDir === null) throw new Error("Claude run directory was not recorded");
    complete({
      ok: true,
      finalText: "Final reply comes from the transcript.",
      threadId: "11111111-1111-4111-8111-111111111111",
      cachedInputTokens: null,
      runDir: providerRunDir,
      stdoutPath: path.join(providerRunDir, "stdout"),
      stderrPath: path.join(providerRunDir, "stderr"),
    });

    await waitForValue(async () => {
      const response = await fetch(new URL("/api/local-console/state?sessionId=default", server.url));
      const state = await response.json() as { activeRuns: Array<{ runId: string }> };
      return state.activeRuns.some((run) => run.runId === active.runId) ? undefined : true;
    }, {
      describe: "Claude run leaves the active registry after completion",
      kind: "io",
      snapshot: () => ({ runClaudeCalls: runClaude.mock.calls.length }),
    });

    const historical = await fetch(new URL(
      `/api/local-console/sessions/default/runs/${encodeURIComponent(active.runId)}/claude-terminal`,
      server.url,
    ));
    expect(historical.status).toBe(200);
    await expect(historical.json()).resolves.toMatchObject({
      sessionId: "default",
      runId: active.runId,
      nextCursor: 2,
      bytesObserved: 20,
      bytesRetained: 20,
      incomplete: false,
    });
  });
});

function cancelledResult(runDir: string): CodexRunResult {
  return {
    ok: false,
    reason: "claude-cancelled",
    runDir,
    stdoutPath: path.join(runDir, "stdout"),
    stderrPath: path.join(runDir, "stderr"),
  };
}
