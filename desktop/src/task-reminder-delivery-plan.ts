import type { LocalRoundTerminalEvent } from "../../src/local-console/round-terminal-event-bus.js";
import type { MacOsNotificationPermissionSnapshot } from "./macos-permission-adapter.js";
import type { PermissionModalAction, PermissionModalEntry } from "./permission-modal-plan.js";

/**
 * 任务提醒投递判定（纯 domain）。
 *
 * 通知/Dock/权限弹窗都是终局事实的消费者：总开关关闭或已投递 → skip；
 * 权限读取失败/未通过 → 弹窗承接；权限允许 → 提交系统通知。
 */

export function decidePermissionAllowed(permission: MacOsNotificationPermissionSnapshot): boolean {
  return permission.error === null
    && (permission.authorizationStatus === "authorized" || permission.authorizationStatus === "provisional");
}

export type TerminalDeliveryPlan =
  | { kind: "skip" }
  | { kind: "modal"; entry: PermissionModalEntry }
  | { kind: "notify"; title: string; body: string };

export function planTerminalDelivery(input: {
  alreadyDelivered: boolean;
  enabled: boolean;
  permission: MacOsNotificationPermissionSnapshot;
  event: LocalRoundTerminalEvent;
}): TerminalDeliveryPlan {
  if (input.alreadyDelivered || !input.enabled) {
    return { kind: "skip" };
  }
  const entry: PermissionModalEntry = {
    eventId: input.event.eventId,
    sessionId: input.event.sessionId,
    title: input.event.conversationTitle,
    outcome: input.event.outcome,
  };
  if (input.permission.error !== null) {
    return { kind: "modal", entry };
  }
  if (!decidePermissionAllowed(input.permission)) {
    return { kind: "modal", entry };
  }
  return {
    kind: "notify",
    title: "Moebius",
    body: `${input.event.conversationTitle}：${planNotificationBody(input.event.outcome)}`,
  };
}

export function planNotificationBody(outcome: LocalRoundTerminalEvent["outcome"]): string {
  switch (outcome) {
    case "awaiting-user":
      return "正在等待你处理";
    case "completed":
      return "已完成";
    case "no-new-content":
      return "本轮没有新增内容";
    case "silent-closeout":
      return "本轮没有明确收尾";
  }
}

export type ModalBridgePlan =
  | { kind: "bridge-request" }
  | { kind: "bridge-recheck" }
  | { kind: "save-close" }
  | { kind: "open-settings" }
  | { kind: "direct" };

export function planModalBridge(
  action: PermissionModalAction,
  lastSubmitOutcome: "ok" | "anomaly" | null = null,
): ModalBridgePlan {
  switch (action.kind) {
    case "request":
      // 最近一次提交异常时权限读取不可信（可能为合成值）：不发起伪成功的授权
      // 请求，直接引导打开系统设置（spec：已拒绝/暂时无法检测时只打开系统设置）。
      return lastSubmitOutcome === "anomaly"
        ? { kind: "open-settings" }
        : { kind: "bridge-request" };
    case "recheck":
      return { kind: "bridge-recheck" };
    case "close-notifications":
      return { kind: "save-close" };
    default:
      return { kind: "direct" };
  }
}

export function planChannelStatus(
  permission: MacOsNotificationPermissionSnapshot,
  enabled: boolean,
  lastSubmitOutcome: "ok" | "anomaly" | null = null,
): "ok" | "anomaly" | "unknown" {
  if (permission.error !== null) {
    return "anomaly";
  }
  if (!enabled) {
    return "unknown";
  }
  // 提交结果优先于权限读取：权限读取可能是合成值（签名验证失败的客户端被
  // usernoted 拒绝时返回合成授权），最近一次真实提交异常说明通道实际不可用，
  // 不得冒充「已恢复」。
  if (lastSubmitOutcome === "anomaly") {
    return "anomaly";
  }
  return decidePermissionAllowed(permission) ? "ok" : "anomaly";
}

/** 投递闸门（domain）：已投递或总开关关闭时跳过（关闭时不读权限、不弹窗、不提交）。 */
export function planPreferenceGate(
  alreadyDelivered: boolean,
  enabled: boolean,
): { kind: "pass" } | { kind: "skip" } {
  return alreadyDelivered || !enabled ? { kind: "skip" } : { kind: "pass" };
}

/** 通知提交结果分类（domain）。 */
export function planChannelOutcome(result: { ok: boolean }): "ok" | "anomaly" {
  return result.ok ? "ok" : "anomaly";
}

/** 偏好保存结果分类（domain）。 */
export function planPreferenceSaveOutcome(saved: boolean): { kind: "saved" } | { kind: "failed" } {
  return saved ? { kind: "saved" } : { kind: "failed" };
}

/** IPC 端口可用性（domain）。 */
export function planTaskReminderApiAvailable(available: boolean): { kind: "available" } | { kind: "unavailable" } {
  return available ? { kind: "available" } : { kind: "unavailable" };
}

/** 读取结果判定（domain）。 */
export function planTaskReminderStateLoaded<T>(state: T | null): { kind: "loaded"; state: T } | { kind: "missing" } {
  return state === null ? { kind: "missing" } : { kind: "loaded", state };
}

/** 权限视图态（domain）：映射授权快照到设置页三态；读取失败进入 unavailable 而非伪装未开启。 */
export function planPermissionViewState(permission: {
  authorizationStatus?: string | null;
  error?: string | null;
} | null): "undetermined" | "allowed" | "denied" | "unavailable" {
  if (permission === null) {
    return "undetermined";
  }
  if (permission.error !== null) {
    return "unavailable";
  }
  if (permission.authorizationStatus === "denied") {
    return "denied";
  }
  return permission.authorizationStatus === "authorized" || permission.authorizationStatus === "provisional"
    ? "allowed"
    : "undetermined";
}

/** 保存完成分类（domain）：成功应用目标值，失败回退旧值。 */
export function planSaveCompletion(
  ok: boolean,
  target: boolean,
  previous: boolean,
): { kind: "applied"; value: boolean } | { kind: "failed"; value: boolean } {
  return ok ? { kind: "applied", value: target } : { kind: "failed", value: previous };
}

/** 重试目标（domain）：上次已知关闭时重试关闭，否则切换当前值。 */
export function planRetrySaveTarget(previous: boolean, current: boolean): boolean {
  return previous === false ? false : !current;
}

/** 上次已知值（domain）。 */
export function planPreviousEnabled(previous: boolean | null): boolean {
  return previous ?? true;
}

/** 保存结果视图（domain）：关闭成功显示「已关闭」。 */
export function planSaveResultView(target: boolean): "closed" | null {
  return target ? null : "closed";
}

/** 竞态守卫（domain）。 */
export function planRaceGuard(settled: boolean): { kind: "proceed" } | { kind: "skip" } {
  return settled ? { kind: "skip" } : { kind: "proceed" };
}

/** 弹窗操作结果分类（domain）。 */
export function planModalActionResult<T>(ok: boolean, state: T | null): { kind: "applied"; state: T } | { kind: "skipped" } {
  return ok && state !== null ? { kind: "applied", state } : { kind: "skipped" };
}

/** 通道复查视图结果（domain）。 */
export function planChannelViewResult(status: "ok" | "anomaly" | "unknown"): "recovered" | "still-anomaly" {
  return status === "ok" ? "recovered" : "still-anomaly";
}

/** 通知点击目标形状（domain，结构上与 transport 载荷一致）。 */
export interface TaskReminderClickTarget {
  sessionId: string;
  roundId: number;
  terminalMessageId: number | null;
}

/** 未消费点击判定（domain）：最近一次点击未被消费时返回定位载荷，否则 null。 */
export function planPendingClick(
  lastClicked: {
    sessionId: string;
    roundId: number;
    terminalMessageId: number | null;
    clickedAt: string;
  } | null,
  lastConsumedClickAt: string | null,
): TaskReminderClickTarget | null {
  if (lastClicked === null) {
    return null;
  }
  if (
    lastConsumedClickAt !== null
    && Date.parse(lastClicked.clickedAt) <= Date.parse(lastConsumedClickAt)
  ) {
    return null;
  }
  return {
    sessionId: lastClicked.sessionId,
    roundId: lastClicked.roundId,
    terminalMessageId: lastClicked.terminalMessageId,
  };
}

/** 点击消费判定（domain）：只有存在点击记录时才推进消费时刻。 */
export function planClickConsumption(lastClicked: {
  clickedAt: string;
} | null): string | null {
  return lastClicked === null ? null : lastClicked.clickedAt;
}

/** 打开系统设置结果分类（domain）。 */
export function planSettingsOpenResult(
  ok: boolean,
): { kind: "settings-opened" } | { kind: "settings-failed" } {
  return ok ? { kind: "settings-opened" } : { kind: "settings-failed" };
}

/** 权限读取需要判定（domain）：从未读取且总开关开启时才读取真实状态。 */
export function planPermissionRefreshNeeded(
  lastPermission: MacOsNotificationPermissionSnapshot | null,
  enabled: boolean,
): { kind: "refresh" } | { kind: "skip" } {
  return lastPermission === null && enabled ? { kind: "refresh" } : { kind: "skip" };
}

/**
 * 授权请求结果判定（domain）：请求失败（如已拒绝 bundle 的
 * UNErrorDomain error 1）时回读真实状态；回读可用则用回读值（denied /
 * authorized），回读仍失败才保留请求错误。
 */
export function planPermissionAfterRequest(
  requested: MacOsNotificationPermissionSnapshot,
  reread: MacOsNotificationPermissionSnapshot,
): MacOsNotificationPermissionSnapshot {
  return requested.error === null || reread.error !== null ? requested : reread;
}

/** 最近一次通知点击载荷（持久化，domain 形状）。 */
export interface TaskReminderLastClicked {
  sessionId: string;
  roundId: number;
  terminalMessageId: number | null;
  clickedAt: string;
}

/** 投递状态持久化版本（domain 契约）。 */
export const TASK_REMINDER_DELIVERY_STATE_VERSION = 1;

/** 投递状态持久化文档（domain 契约）：已投递事件、待展示弹窗与点击载荷。 */
export interface TaskReminderDeliveryPersistedState {
  version: typeof TASK_REMINDER_DELIVERY_STATE_VERSION;
  deliveredEventIds: string[];
  modalEntries: PermissionModalEntry[];
  lastClicked: TaskReminderLastClicked | null;
  lastConsumedClickAt: string | null;
}
