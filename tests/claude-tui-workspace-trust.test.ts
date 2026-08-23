import { describe, expect, it } from "vitest";

import { ClaudeTuiWorkspaceTrustDetector } from "../src/claude-tui-workspace-trust.js";

describe("ClaudeTuiWorkspaceTrustDetector", () => {
  it("recognizes the native English prompt across ANSI-fragmented terminal data", () => {
    const detector = new ClaudeTuiWorkspaceTrustDetector();

    expect(detector.observe("\u001b[2JQuick safety check: Is this a project you created")).toBe("waiting");
    expect(detector.observe(" or one you trust?\r\n1. Yes, I trust this folder\r\n2. No, exit")).toBe("workspace-trust-required");
  });

  it("recognizes Claude's redraw form when terminal cells contain no visible spaces", () => {
    const detector = new ClaudeTuiWorkspaceTrustDetector();

    expect(detector.observe("Quicksafetycheck:Isthisaprojectyoucreatedoroneyoutrust?\n❯1.Yes,Itrustthisfolder\n2.No,exit")).toBe("workspace-trust-required");
  });

  it("does not treat ordinary terminal output as trust and waits for Claude's input prompt", () => {
    const detector = new ClaudeTuiWorkspaceTrustDetector();

    expect(detector.observe("Welcome to Claude Code\r\n")).toBe("waiting");
    expect(detector.observe(new Uint8Array(Buffer.from("\u001b[38;5;99m❯ \u001b[0m", "utf8")))).toBe("terminal-ready");
  });

  it("ignores a repeated trust redraw after automatic confirmation and awaits the normal prompt", () => {
    const detector = new ClaudeTuiWorkspaceTrustDetector();

    expect(detector.observe("Quick safety check: I trust this folder. No, exit.")).toBe("workspace-trust-required");
    detector.resetAfterTrust();
    expect(detector.observe("Quick safety check: I trust this folder. No, exit.")).toBe("waiting");
    expect(detector.observe("\n❯ ")).toBe("terminal-ready");
  });

  it("recognizes the current nonempty native input affordance after automatic trust", () => {
    const detector = new ClaudeTuiWorkspaceTrustDetector();

    expect(detector.observe("是否信任此文件夹")).toBe("workspace-trust-required");
    detector.resetAfterTrust();
    expect(detector.observe("\r\u001b[1B❯\u00A0Try \"write a test for <filepath>\"\u001b[K")).toBe("terminal-ready");
  });
});
