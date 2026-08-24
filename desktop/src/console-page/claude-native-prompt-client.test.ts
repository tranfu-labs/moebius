import { describe, expect, it, vi } from "vitest";

import {
  ClaudeNativePromptSelectionRequestError,
  selectClaudeNativePrompt,
} from "./console-api-client.js";

describe("Claude native prompt browser bridge", () => {
  it("sends only the session, decision, and option number", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ accepted: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(selectClaudeNativePrompt({
      apiBase: "http://127.0.0.1:43123/",
      sessionId: "claude-session-1",
      decisionId: "decision-1",
      optionNumber: 2,
      fetch,
    })).resolves.toEqual({ accepted: true });

    const request = fetch.mock.calls[0];
    expect(String(request?.[0])).toBe("http://127.0.0.1:43123/api/local-console/claude-native-prompt");
    expect(request?.[1]).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      sessionId: "claude-session-1",
      decisionId: "decision-1",
      optionNumber: 2,
    });
  });

  it("preserves the server rejection code for stale choices", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      error: "Claude 原生确认状态已变化，请重新选择。",
      code: "CLAUDE_NATIVE_PROMPT_STATE_CHANGED",
    }), {
      status: 409,
      headers: { "content-type": "application/json" },
    }));

    const error = await selectClaudeNativePrompt({
      apiBase: "http://127.0.0.1:43123",
      sessionId: "claude-session-1",
      decisionId: "decision-1",
      optionNumber: 2,
      fetch,
    }).then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(ClaudeNativePromptSelectionRequestError);
    expect(error).toMatchObject({
      status: 409,
      code: "CLAUDE_NATIVE_PROMPT_STATE_CHANGED",
      message: "Claude 原生确认状态已变化，请重新选择。",
    });
  });
});
