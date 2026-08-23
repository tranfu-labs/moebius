import type { ClaudeTuiTerminalData } from "./claude-tui-transport.js";

export type ClaudeTuiWorkspaceTrustDetection =
  | "waiting"
  | "workspace-trust-required"
  | "terminal-ready";

const MAX_TERMINAL_TAIL_LENGTH = 16_384;

/**
 * Detects the one native Claude Code safety prompt that can precede the first
 * human task. This is deliberately not a terminal parser: lifecycle, final
 * text and usage remain hook/transcript facts. The detector is discarded as
 * soon as a task has entered the PTY so Claude output can never imitate it.
 */
export class ClaudeTuiWorkspaceTrustDetector {
  private rawTail = "";
  private detection: ClaudeTuiWorkspaceTrustDetection = "waiting";
  private trustPromptHandled = false;

  observe(data: ClaudeTuiTerminalData): ClaudeTuiWorkspaceTrustDetection {
    if (this.detection !== "waiting") return this.detection;
    this.rawTail = `${this.rawTail}${toTerminalText(data)}`.slice(-MAX_TERMINAL_TAIL_LENGTH);
    const visible = normalizeTerminal(this.rawTail);
    if (!this.trustPromptHandled && isWorkspaceTrustPrompt(visible)) {
      this.detection = "workspace-trust-required";
      return this.detection;
    }
    if (isInitialInputPrompt(visible)) {
      this.detection = "terminal-ready";
    }
    return this.detection;
  }

  resetAfterTrust(): void {
    this.rawTail = "";
    this.detection = "waiting";
    // Native prompt redraws can arrive after Enter is written. From this
    // point forward only the normal input affordance may advance bootstrap;
    // a repeated trust-looking terminal fragment can never produce a second
    // native confirmation.
    this.trustPromptHandled = true;
  }
}

function toTerminalText(data: ClaudeTuiTerminalData): string {
  return typeof data === "string" ? data : Buffer.from(data).toString("utf8");
}

function normalizeTerminal(raw: string): string {
  return raw
    // OSC must be removed before CSI because hyperlinks and title updates may
    // contain printable text that is not visible in the terminal.
    .replace(/\u001B\][\s\S]*?(?:\u0007|\u001B\\)/gu, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\r/gu, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/gu, "");
}

function isWorkspaceTrustPrompt(visible: string): boolean {
  // Claude's TUI redraw path can emit the visible English words in adjacent
  // terminal cells (the raw PTY probe produced `Quicksafetycheck`). Match the
  // semantic token sequence, not its presentation whitespace.
  const compact = visible.replace(/\s+/gu, "").toLowerCase();
  return (
    (compact.includes("quicksafetycheck")
      && compact.includes("itrustthisfolder")
      && compact.includes("no,exit"))
    || /信任此文件夹/u.test(visible)
    || /是否信任.{0,32}文件夹/u.test(visible)
  );
}

function isInitialInputPrompt(visible: string): boolean {
  // Claude Code 2.1.239 renders the post-trust ready prompt as
  // `❯ Try "write a test for <filepath>"` (with a non-breaking space), rather
  // than an otherwise empty `❯` line. This detector remains limited to the
  // native pre-task input affordance: the trust prompt itself is checked first.
  return /(?:^|\n)[\t \u00A0]*❯(?:[\t \u00A0]*$|[\t \u00A0]+(?:Try\b|尝试))/mu.test(visible);
}
