import { describe, expect, it, vi } from "vitest";

import { buildPiSystemPrompt, executePiHostInvocation } from "../src/pi-agent-runtime.js";
import { MANAGED_PROCESS_RUNTIME_CONTRACT } from "../src/local-console/prompt.js";
import { PiProviderValidationError } from "../src/pi-provider-validator.js";

describe("Pi Agent runtime model boundaries", () => {
  it("fails before provider access when a text-only DeepSeek model receives an image", async () => {
    await expect(executePiHostInvocation({
      frame: {
        version: 1,
        type: "start",
        credential: { apiKey: "sk-test-only" },
        invocation: {
          kind: "run",
          providerId: "deepseek",
          model: "deepseek-v4-pro",
          effort: "high",
          cwd: "/tmp/workspace",
          agentDir: "/tmp/agent",
          sessionDir: "/tmp/pi-session-not-created",
          nativeSessionPath: null,
          prompt: "Inspect this image",
          imagePaths: ["/tmp/input.png"],
          managedProcessMcp: null,
        },
      },
      signal: new AbortController().signal,
      emit: vi.fn(),
    })).rejects.toMatchObject({
      code: "model-incompatible",
      message: expect.stringContaining("仅支持文本输入"),
    } satisfies Partial<PiProviderValidationError>);
  });

  it("states managed-process tools are unavailable when no bridge is injected", () => {
    const prompt = buildPiSystemPrompt(null);
    expect(prompt).toContain("Managed long-running process tools are unavailable in this run.");
  });

  it("reuses the single Runtime Contract constant when a bridge is injected", () => {
    const prompt = buildPiSystemPrompt({ command: "/usr/bin/node", args: [], env: {}, cwd: "/tmp" });
    expect(prompt).toContain(MANAGED_PROCESS_RUNTIME_CONTRACT);
    expect(prompt).not.toContain("Managed long-running process tools are unavailable in this run.");
  });
});
