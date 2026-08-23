import type { LocalRunSourceDisposition } from "./codex-resume.js";
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
  processOutputAvailable: boolean;
  terminalRecorded: boolean;
  controller: AbortController;
  threadId: string | null;
  gracefulResumePrepared: boolean;
}
