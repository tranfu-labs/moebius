import type { LocalRunActivity } from "./run-activity.js";
import type { LocalConsoleExecutionProfile } from "./types.js";

/**
 * 终局记录的内容（归属与冻结的过程步骤）由 domain 一次性决定，adapter 只写被交给的值，
 * runtime 只把决定交给端口。所有 `??` 兜底都住在这里，不进 application / adapter。
 */

export interface LocalTerminalRecordDecision {
  role: string | null;
  processSteps: readonly LocalRunActivity[];
}

export interface LocalTerminalRecordSource {
  /** 可缺省：无主通知与运行前失败没有可归属的成员。 */
  role?: string | null;
  /** 运行内存快照；domain 负责缺省为空（没有可冻结的步骤）。 */
  activeRun?: { activitySteps?: readonly LocalRunActivity[] } | undefined;
  /** 已显式给定的过程步骤，优先于 activeRun 快照。 */
  processSteps?: readonly LocalRunActivity[] | undefined;
}

/** 终局记录 = 有主或明确无主的 role + 终态时冻结的步骤（缺省为空数组）。 */
export function planTerminalRecord(source: LocalTerminalRecordSource): LocalTerminalRecordDecision {
  return {
    role: source.role ?? null,
    processSteps: source.processSteps ?? source.activeRun?.activitySteps ?? [],
  };
}

/**
 * 运行归属：消息自带 role 优先，否则用派发时的成员（dispatchRole）。
 * 用于读取侧从消息记录反推「这次运行属于谁」。
 */
export function planRunMemberRole(message: {
  role: string | null;
  dispatchRole?: string | null;
}): string | null {
  return message.role ?? message.dispatchRole ?? null;
}

/** stale-running 批量卡住时，每个候选消息的归属由 domain 预先决定，adapter 只查表。 */
export function planStaleRunningRoles(
  messages: readonly { id: number; role: string | null; dispatchRole?: string | null }[],
): Record<number, string | null> {
  const roles: Record<number, string | null> = {};
  for (const message of messages) {
    roles[message.id] = planRunMemberRole(message);
  }
  return roles;
}

/**
 * 失败收口的活动运行快照缺省：没有对应活动 run 时，落成「未知 runId + 无进度」
 * 的确定性形状。与 run-failure-plan 的 null-runId 缺省区分：detached 收口不需要
 * runId 参与决策，只需要一个非空哨兵。
 */
export function planActiveFailureContext(active: {
  runId: string;
  gracefulResumePrepared: boolean;
  liveMarkdown: string | null;
  profile: LocalConsoleExecutionProfile | null;
} | undefined): {
  runId: string;
  gracefulResumePrepared: boolean;
  liveMarkdown: string | null;
  profile: LocalConsoleExecutionProfile | null;
} {
  return active ?? {
    runId: "unknown",
    gracefulResumePrepared: false,
    liveMarkdown: null,
    profile: null,
  };
}

/**
 * 时间线过程步骤的展示形状（与 console-ui 的 ProcessStep 结构一致）。
 * 运行时的实时映射住在 view 侧（activityStepsToProcessSteps）；持久化消息的
 * 映射由本 domain 函数产出，view 只消费该形状。
 */
export type LocalTerminalProcessStepKind = "thinking" | "tool" | "command" | "file" | "search";

export interface LocalTerminalProcessStep {
  id: string;
  kind: LocalTerminalProcessStepKind;
  /** One line, already human-readable — this is not a raw log line. */
  title: string;
  detail?: string | null;
  status?: "running" | "done" | "failed";
}

const TERMINAL_STEP_KIND: Record<string, LocalTerminalProcessStepKind | undefined> = {
  thinking: "thinking",
  tool: "tool",
  command: "command",
  search: "search",
  read: "file",
  edit: "file",
};

/** Runtime activity records to timeline steps; `progress` is the streamed answer, not a step. */
export function planTerminalProcessSteps(
  steps: readonly LocalRunActivity[] | undefined,
): readonly LocalTerminalProcessStep[] {
  if (steps === undefined) return [];
  const mapped: LocalTerminalProcessStep[] = [];
  steps.forEach((step, index) => {
    const kind = TERMINAL_STEP_KIND[step.kind];
    if (kind === undefined) return;
    mapped.push({
      id: `${step.occurredAt}-${String(index)}`,
      kind,
      title: step.action,
      detail: step.object,
      status: step.phase === "completed" ? "done" : "running",
    });
  });
  return mapped;
}
