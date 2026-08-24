import { describe, expect, it } from "vitest";

import { ClaudeTuiNativePromptDetector } from "../src/claude-tui-native-prompt.js";

function detector(stallMs = 1_000): ClaudeTuiNativePromptDetector {
  return new ClaudeTuiNativePromptDetector({ stallMs, startedAt: 0 });
}

describe("ClaudeTuiNativePromptDetector", () => {
  it("recognizes workspace trust across ANSI-fragmented terminal data", () => {
    const instance = detector();

    expect(instance.observe("\u001b[2JQuick safety check: Is this a project you created", 10)).toEqual({ state: "waiting" });
    expect(instance.observe(" or one you trust?\r\n1. Yes, I trust this folder\r\n2. No, exit", 20)).toEqual({
      state: "native-prompt",
      kind: "workspace-trust",
    });
  });

  it("recognizes resume mode and MCP authorization prompts", () => {
    const instance = detector();

    expect(instance.observe(
      "This session is old.\n1. Resume from summary (recommended)\n2. Resume full session as-is\n3. Don't ask me again",
      10,
    )).toEqual({ state: "native-prompt", kind: "resume-mode" });

    instance.markNativePromptHandled("resume-mode", 20);
    expect(instance.observe(
      "New MCP server found in this project: moebius_managed\n1. Use this MCP server\n2. Use this and all future MCP servers in this project\n3. Continue without using this MCP server",
      30,
    )).toEqual({ state: "native-prompt", kind: "mcp-authorization" });
  });

  it("recognizes the nonempty native input affordance", () => {
    const instance = detector();

    expect(instance.observe("Welcome to Claude Code\r\n", 10)).toEqual({ state: "waiting" });
    expect(instance.observe("\r\u001b[1B❯\u00A0Try \"write a test for <filepath>\"\u001b[K", 20)).toEqual({
      state: "terminal-ready",
    });
  });

  it("extracts a contiguous unknown menu only after a live PTY stalls", () => {
    const instance = detector(100);

    expect(instance.observe("Security decision:\n❯ 1. Allow for this run\n  2. Deny and stop\n", 10)).toEqual({ state: "waiting" });
    expect(instance.checkStall({ now: 99, ptyAlive: true })).toEqual({ state: "waiting" });
    expect(instance.checkStall({ now: 110, ptyAlive: true })).toEqual({
      state: "native-prompt",
      kind: "unknown-choice",
      options: [
        { number: 1, label: "Allow for this run", raw: "❯ 1. Allow for this run" },
        { number: 2, label: "Deny and stop", raw: "2. Deny and stop" },
      ],
    });
  });

  it("fails safely without options and never stalls a dead PTY", () => {
    const noOptions = detector(100);
    noOptions.observe("Waiting for an unrecognized native confirmation", 10);
    expect(noOptions.checkStall({ now: 110, ptyAlive: true })).toEqual({
      state: "stalled",
      excerpt: "Waiting for an unrecognized native confirmation",
    });

    const dead = detector(100);
    dead.observe("Waiting", 10);
    expect(dead.checkStall({ now: 110, ptyAlive: false })).toEqual({ state: "waiting" });
  });

  it("does not repeat a handled known prompt and stops after task activation", () => {
    const instance = detector();
    const trust = "Quick safety check: I trust this folder. No, exit.";

    expect(instance.observe(trust, 10)).toEqual({ state: "native-prompt", kind: "workspace-trust" });
    instance.markNativePromptHandled("workspace-trust", 20);
    expect(instance.observe(trust, 30)).toEqual({ state: "waiting" });

    instance.stop();
    expect(instance.observe(
      "New MCP server found in this project: moebius_managed\n1. Use this MCP server\n2. Continue without using this MCP server",
      40,
    )).toEqual({ state: "waiting" });
    expect(instance.checkStall({ now: 10_000, ptyAlive: true })).toEqual({ state: "waiting" });
  });

  it("rejects invalid stall thresholds", () => {
    expect(() => new ClaudeTuiNativePromptDetector({ stallMs: 0 })).toThrow(
      "claude-tui-native-prompt-invalid-stall-ms",
    );
  });
});
