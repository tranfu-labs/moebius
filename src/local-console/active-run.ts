import type { LocalRunSourceDisposition } from "./codex-resume.js";
import type { ClaudeTuiNativePromptDecision } from "../claude.js";
import type {
  ClaudeTuiNativePromptSelectionInput,
  ClaudeTuiNativePromptSelectionResult,
} from "../claude.js";
import type { LocalRunActivity } from "./run-activity.js";
import type { LocalClaudeTerminalTrace } from "./claude-terminal-trace.js";
import type {
  LocalConsoleExecutionEngine,
  LocalConsoleExecutionProfile,
} from "./types.js";

export interface ActiveLocalRun {
  sessionId: string;
  runId: string;
  userMessageId: number;
  role: string | null;
  lane: "primary" | "worker";
  sourceDisposition: LocalRunSourceDisposition;
  runDir: string | null;
  cwd: string | null;
  workspaceMode: "direct" | "worktree" | null;
  worktreeUnavailableReason: string | null;
  branchName: string | null;
  baseRef: string | null;
  originalRepoRoot: string | null;
  liveMarkdown: string | null;
  activity: LocalRunActivity | null;
  /** Steps this run has taken (thinking / tool / command / file), for the timeline trail. */
  activitySteps: LocalRunActivity[];
  activitySequence: number;
  activityFactTail: Promise<void>;
  longRunReported: boolean;
  createdAt: string;
  startedAt: string | null;
  segmentStartedAt: string | null;
  accumulatedMs: number;
  resuming: boolean;
  stepId: string;
  attempt: number;
  engine: LocalConsoleExecutionEngine;
  profile: LocalConsoleExecutionProfile | null;
  /** Claude-only raw PTY byte trace; never projected into session Markdown. */
  claudeTerminalTrace: LocalClaudeTerminalTrace | null;
  /** Claude-only pending native confirmation; contains no PTY key or command. */
  nativePromptDecision: ClaudeTuiNativePromptDecision | null;
  processOutputAvailable: boolean;
  terminalRecorded: boolean;
  controller: AbortController;
  threadId: string | null;
  gracefulResumePrepared: boolean;
}

export function decideLocalClaudeNativePromptPublication(
  active: Pick<ActiveLocalRun, "engine" | "nativePromptDecision"> | undefined,
  decision: ClaudeTuiNativePromptDecision,
):
  | { kind: "ignore" }
  | {
      kind: "publish";
      active: Pick<ActiveLocalRun, "nativePromptDecision">;
      decision: ClaudeTuiNativePromptDecision;
    } {
  return active?.engine === "claude"
    ? { kind: "publish", active, decision }
    : { kind: "ignore" };
}

export function decideLocalClaudeNativePromptClear(
  active: Pick<ActiveLocalRun, "nativePromptDecision">,
  input: ClaudeTuiNativePromptSelectionInput,
): { kind: "clear"; active: Pick<ActiveLocalRun, "nativePromptDecision"> } | { kind: "skip" } {
  return active.nativePromptDecision?.sessionId === input.sessionId
    && active.nativePromptDecision.decisionId === input.decisionId
    ? { kind: "clear", active }
    : { kind: "skip" };
}

export function decideLocalClaudeNativePromptSelection(
  result: ClaudeTuiNativePromptSelectionResult,
): { kind: "clear" } | { kind: "keep" } {
  return result.kind === "accepted" ? { kind: "clear" } : { kind: "keep" };
}

export function decideLocalClaudeNativePromptController(
  controller: ((input: ClaudeTuiNativePromptSelectionInput) => ClaudeTuiNativePromptSelectionResult) | undefined,
  input: ClaudeTuiNativePromptSelectionInput,
): ClaudeTuiNativePromptSelectionResult {
  return controller === undefined
    ? { kind: "rejected", reason: "session-not-found" }
    : controller(input);
}
