import type { ClaudeTuiTerminalData } from "./claude-tui-transport.js";

export type ClaudeTuiNativePromptKind =
  | "workspace-trust"
  | "resume-mode"
  | "mcp-authorization";

export interface ClaudeTuiNativePromptOption {
  number: number;
  label: string;
  raw: string;
}

export type ClaudeTuiNativePromptDetection =
  | { state: "waiting" }
  | {
      state: "native-prompt";
      kind: ClaudeTuiNativePromptKind;
    }
  | {
      state: "native-prompt";
      kind: "unknown-choice";
      options: readonly ClaudeTuiNativePromptOption[];
    }
  | { state: "terminal-ready" }
  | { state: "stalled"; excerpt: string };

export interface ClaudeTuiNativePromptDetectorOptions {
  stallMs: number;
  startedAt?: number;
}

const MAX_TERMINAL_TAIL_LENGTH = 16_384;

export class ClaudeTuiNativePromptError extends Error {
  constructor(readonly code: "claude-tui-native-prompt-invalid-stall-ms") {
    super(code);
    this.name = "ClaudeTuiNativePromptError";
  }
}

/**
 * Observes only the pre-task terminal projection of a Claude TUI.
 *
 * Lifecycle, transcript, final text and usage remain outside this detector.
 * The runtime discards it as soon as the first task is written, so later
 * Agent output cannot imitate a native confirmation.
 */
export class ClaudeTuiNativePromptDetector {
  private rawTail = "";
  private detection: ClaudeTuiNativePromptDetection = { state: "waiting" };
  private readonly handledKinds = new Set<ClaudeTuiNativePromptKind>();
  private readonly stallMs: number;
  private lastOutputAt: number;
  private active = true;

  constructor(options: ClaudeTuiNativePromptDetectorOptions) {
    if (!Number.isFinite(options.stallMs) || options.stallMs <= 0) {
      throw new ClaudeTuiNativePromptError("claude-tui-native-prompt-invalid-stall-ms");
    }
    this.stallMs = options.stallMs;
    this.lastOutputAt = options.startedAt ?? Date.now();
  }

  observe(data: ClaudeTuiTerminalData, observedAt = Date.now()): ClaudeTuiNativePromptDetection {
    if (!this.active || this.detection.state !== "waiting") return this.detection;

    const text = toTerminalText(data);
    if (text.length > 0) {
      this.rawTail = `${this.rawTail}${text}`.slice(-MAX_TERMINAL_TAIL_LENGTH);
      this.lastOutputAt = observedAt;
    }

    const visible = normalizeTerminal(this.rawTail);
    const knownKind = detectKnownPrompt(visible, this.handledKinds);
    if (knownKind !== null) {
      this.detection = { state: "native-prompt", kind: knownKind };
      return this.detection;
    }
    if (isInitialInputPrompt(visible)) {
      this.detection = { state: "terminal-ready" };
    }
    return this.detection;
  }

  checkStall(input: { now?: number; ptyAlive: boolean }): ClaudeTuiNativePromptDetection {
    if (!this.active || this.detection.state !== "waiting" || !input.ptyAlive) {
      return this.detection;
    }
    const now = input.now ?? Date.now();
    if (now - this.lastOutputAt < this.stallMs) return this.detection;

    const visible = normalizeTerminal(this.rawTail);
    const options = extractCandidateOptions(visible);
    if (options.length > 0) {
      this.detection = { state: "native-prompt", kind: "unknown-choice", options };
    } else {
      this.detection = {
        state: "stalled",
        excerpt: visible.slice(-MAX_TERMINAL_TAIL_LENGTH),
      };
    }
    return this.detection;
  }

  markNativePromptHandled(kind: ClaudeTuiNativePromptKind, handledAt = Date.now()): void {
    this.handledKinds.add(kind);
    this.rawTail = "";
    this.lastOutputAt = handledAt;
    this.detection = { state: "waiting" };
  }

  markUnknownPromptHandled(handledAt = Date.now()): void {
    this.rawTail = "";
    this.lastOutputAt = handledAt;
    this.detection = { state: "waiting" };
  }

  nextStallDelayMs(now = Date.now()): number {
    return Math.max(0, this.stallMs - (now - this.lastOutputAt));
  }

  stop(): void {
    this.active = false;
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
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/gu, "");
}

function detectKnownPrompt(
  visible: string,
  handledKinds: ReadonlySet<ClaudeTuiNativePromptKind>,
): ClaudeTuiNativePromptKind | null {
  if (!handledKinds.has("workspace-trust") && isWorkspaceTrustPrompt(visible)) {
    return "workspace-trust";
  }
  if (!handledKinds.has("resume-mode") && isResumeModePrompt(visible)) {
    return "resume-mode";
  }
  if (!handledKinds.has("mcp-authorization") && isMcpAuthorizationPrompt(visible)) {
    return "mcp-authorization";
  }
  return null;
}

function isWorkspaceTrustPrompt(visible: string): boolean {
  const compact = visible.replace(/\s+/gu, "").toLowerCase();
  return (
    (compact.includes("quicksafetycheck")
      && compact.includes("itrustthisfolder")
      && compact.includes("no,exit"))
    || /信任此文件夹/u.test(visible)
    || /是否信任.{0,32}文件夹/u.test(visible)
  );
}

function isResumeModePrompt(visible: string): boolean {
  const compact = compactPromptText(visible);
  return compact.includes("resumefromsummary")
    && compact.includes("resumefullsessionasis")
    && compact.includes("dontaskmeagain");
}

function isMcpAuthorizationPrompt(visible: string): boolean {
  const compact = compactPromptText(visible);
  return compact.includes("newmcpserverfound")
    && compact.includes("moebiusmanaged")
    && compact.includes("usethismcpserver")
    && compact.includes("continuewithoutusingthismcpserver");
}

function compactPromptText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s'’"：:，。,._-]/gu, "");
}

function isInitialInputPrompt(visible: string): boolean {
  return /(?:^|\n)[\t \u00A0]*❯(?:[\t \u00A0]*$|[\t \u00A0]+(?:Try\b|尝试))/mu.test(visible);
}

function extractCandidateOptions(visible: string): readonly ClaudeTuiNativePromptOption[] {
  const groups: ClaudeTuiNativePromptOption[][] = [];
  let current: ClaudeTuiNativePromptOption[] = [];
  let previousLine = -2;
  let previousNumber = -1;

  for (const [lineNumber, line] of visible.split("\n").entries()) {
    const match = line.match(/^[\t \u00A0]*(?:❯[\t \u00A0]*)?(\d{1,3})\.[\t \u00A0]+(.+?)\s*$/u);
    if (match === null) {
      if (current.length >= 2) groups.push(current);
      current = [];
      previousLine = -2;
      previousNumber = -1;
      continue;
    }

    const number = Number(match[1]);
    if (lineNumber !== previousLine + 1 || number !== previousNumber + 1) {
      if (current.length >= 2) groups.push(current);
      current = [];
    }
    current.push({
      number,
      label: match[2].trim(),
      raw: line.trim(),
    });
    previousLine = lineNumber;
    previousNumber = number;
  }
  if (current.length >= 2) groups.push(current);

  return groups.at(-1) ?? [];
}
