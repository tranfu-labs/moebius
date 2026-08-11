import type { LocalConsoleMessageStatus } from "./types.js";
import { planRunMemberRole } from "./terminal-record-plan.js";

/**
 * 一条被判定为孤儿的运行——需要在启动 catch-up 时确定性落成既有的 stuck 状态。
 * 「孤儿」= SQLite 标记 running,但当前进程内存中没有对应活动 run。
 * 见 openspec/specs/local-console/spec.md「孤儿运行在重启后被确定性识别为卡住」。
 */
export interface OrphanRunCandidate {
  userMessageId: number;
  runId: string | null;
  runDir: string | null;
  /** Member the orphan run belonged to (the claimed message's dispatch role). */
  role: string | null;
}

export interface OrphanRunInputMessage {
  id: number;
  status: LocalConsoleMessageStatus;
  runId: string | null;
  runDir: string | null;
  role: string | null;
  dispatchRole?: string | null;
}

export interface OrphanRunInput {
  sessionId: string;
  messages: ReadonlyArray<OrphanRunInputMessage>;
  activeSessionIds: ReadonlySet<string>;
}

export function identifyOrphanRuns(input: OrphanRunInput): OrphanRunCandidate[] {
  if (input.activeSessionIds.has(input.sessionId)) {
    return [];
  }
  const orphans: OrphanRunCandidate[] = [];
  for (const message of input.messages) {
    if (message.status !== "running") {
      continue;
    }
    orphans.push({
      userMessageId: message.id,
      runId: message.runId,
      runDir: message.runDir,
      role: planRunMemberRole(message),
    });
  }
  return orphans;
}

export const ORPHAN_RUN_STUCK_REASON = "orphaned-by-restart";
