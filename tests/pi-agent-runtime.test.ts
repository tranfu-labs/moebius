import { describe, expect, it, vi } from "vitest";

import { executePiHostInvocation } from "../src/pi-agent-runtime.js";
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
});
