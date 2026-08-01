import type { LocalRunSourceDisposition } from "./codex-resume.js";
import type { LocalRunActivity } from "./run-activity.js";
import type { LocalConsoleExecutionProfile } from "./types.js";

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
  engine: "codex" | "claude" | "kimi";
  profile: LocalConsoleExecutionProfile | null;
  processOutputAvailable: boolean;
  terminalRecorded: boolean;
  controller: AbortController;
  threadId: string | null;
  gracefulResumePrepared: boolean;
}
