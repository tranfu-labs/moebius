import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ClaudeTuiNativePromptSelectionInput,
  ClaudeTuiNativePromptSelectionResult,
} from "../src/claude.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../src/local-console/start.js";

const roots: string[] = [];
const servers: StartedLocalConsoleServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => await server.close()));
  await Promise.all(roots.splice(0).map(async (root) => await fs.rm(root, { recursive: true, force: true })));
});

describe("Claude native prompt HTTP control", () => {
  it("accepts only the narrow selection and never exposes the derived PTY key", async () => {
    const selectNativePrompt = vi.fn<
      (input: ClaudeTuiNativePromptSelectionInput) => ClaudeTuiNativePromptSelectionResult
    >(() => ({ kind: "accepted" }));
    const server = await startTestServer(selectNativePrompt);

    const response = await postSelection(server, {
      sessionId: "claude-session-1",
      decisionId: "decision-1",
      optionNumber: 2,
    });

    expect(response.status).toBe(200);
    const responseBody = await response.json() as Record<string, unknown>;
    expect(responseBody).toEqual({ accepted: true });
    expect(selectNativePrompt).toHaveBeenCalledOnce();
    expect(selectNativePrompt).toHaveBeenCalledWith({
      sessionId: "claude-session-1",
      decisionId: "decision-1",
      optionNumber: 2,
    });
    expect(responseBody).not.toHaveProperty("key");
  });

  it("rejects arbitrary key, text, command, and malformed index input before dispatch", async () => {
    const selectNativePrompt = vi.fn<
      (input: ClaudeTuiNativePromptSelectionInput) => ClaudeTuiNativePromptSelectionResult
    >(() => ({ kind: "accepted" }));
    const server = await startTestServer(selectNativePrompt);

    for (const body of [
      { sessionId: "claude-session-1", decisionId: "decision-1", optionNumber: 2, key: "2" },
      { sessionId: "claude-session-1", decisionId: "decision-1", optionNumber: 2, text: "yes" },
      { sessionId: "claude-session-1", decisionId: "decision-1", optionNumber: 2, command: "continue" },
      { sessionId: "claude-session-1", decisionId: "decision-1", optionNumber: 0 },
      { sessionId: "claude-session-1", decisionId: "decision-1", optionNumber: "2" },
    ]) {
      const response = await postSelection(server, body);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "INVALID_CLAUDE_NATIVE_PROMPT_REQUEST",
      });
    }
    expect(selectNativePrompt).not.toHaveBeenCalled();
  });

  it("maps stale, invalid-option, and write failures without accepting them", async () => {
    const selectNativePrompt = vi.fn<
      (input: ClaudeTuiNativePromptSelectionInput) => ClaudeTuiNativePromptSelectionResult
    >()
      .mockReturnValueOnce({ kind: "rejected", reason: "no-pending-decision" })
      .mockReturnValueOnce({ kind: "rejected", reason: "option-not-found" })
      .mockReturnValueOnce({ kind: "rejected", reason: "write-failed" })
      .mockReturnValueOnce({ kind: "accepted", replayed: true });
    const server = await startTestServer(selectNativePrompt);

    const stale = await postSelection(server, validSelection());
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({
      error: "Claude 原生确认状态已变化，请重新选择。",
      code: "CLAUDE_NATIVE_PROMPT_STATE_CHANGED",
    });

    const invalidOption = await postSelection(server, validSelection());
    expect(invalidOption.status).toBe(409);
    await expect(invalidOption.json()).resolves.toEqual({
      error: "Claude 原生确认状态已变化，请重新选择。",
      code: "CLAUDE_NATIVE_PROMPT_OPTION_INVALID",
    });

    const writeFailed = await postSelection(server, validSelection());
    expect(writeFailed.status).toBe(503);
    await expect(writeFailed.json()).resolves.toEqual({
      error: "Claude 原生确认未能发送，请重试。",
      code: "CLAUDE_NATIVE_PROMPT_WRITE_FAILED",
    });

    const replayed = await postSelection(server, validSelection());
    expect(replayed.status).toBe(200);
    await expect(replayed.json()).resolves.toEqual({ accepted: true, replayed: true });
  });
});

async function startTestServer(
  selectClaudeNativePrompt: (input: ClaudeTuiNativePromptSelectionInput) => ClaudeTuiNativePromptSelectionResult,
): Promise<StartedLocalConsoleServer> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-claude-native-prompt-api-"));
  roots.push(root);
  const server = await startLocalConsoleServer({
    host: "127.0.0.1",
    port: 0,
    projectRoot: root,
    listAgentFiles: async () => [],
    runCodex: vi.fn(),
    runClaude: vi.fn(),
    selectClaudeNativePrompt,
    enableSessionTitleGeneration: false,
  });
  servers.push(server);
  return server;
}

async function postSelection(
  server: StartedLocalConsoleServer,
  body: Record<string, unknown>,
): Promise<Response> {
  return await fetch(new URL("/api/local-console/claude-native-prompt", server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validSelection(): Record<string, unknown> {
  return {
    sessionId: "claude-session-1",
    decisionId: "decision-1",
    optionNumber: 2,
  };
}
