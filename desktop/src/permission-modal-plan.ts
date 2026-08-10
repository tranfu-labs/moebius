/**
 * 权限恢复弹窗状态机（纯 domain，可单测）。
 *
 * 弹窗是唯一的应用内权限恢复入口：多段对话按形成顺序合并进一个弹窗；
 * 无第四种静默关闭（Escape/遮罩/标题栏关闭均不可用，由 renderer 强制）。
 */

export type PermissionModalPhase =
  | "idle"
  | "requesting"
  | "request-done"
  | "opening-settings"
  | "opened"
  | "failed"
  | "closing-save"
  | "closing-save-failed";

export interface PermissionModalEntry {
  /** 终局事件 id（持久化投递状态的幂等键）。 */
  eventId: string;
  sessionId: string;
  title: string;
  outcome: "completed" | "awaiting-user" | "no-new-content" | "silent-closeout";
}

export interface PermissionModalState {
  open: boolean;
  phase: PermissionModalPhase;
  entries: PermissionModalEntry[];
  saveFailed: boolean;
}

export type PermissionModalAction =
  | { kind: "open"; entry: PermissionModalEntry }
  | { kind: "request" }
  | { kind: "request-finished"; permissionAllowed: boolean }
  | { kind: "open-settings" }
  | { kind: "settings-opened" }
  | { kind: "settings-failed" }
  | { kind: "recheck"; permissionAllowed: boolean }
  | { kind: "close-notifications" }
  | { kind: "close-save-finished" }
  | { kind: "close-save-failed" };

export function createPermissionModalState(): PermissionModalState {
  return { open: false, phase: "idle", entries: [], saveFailed: false };
}

export function planPermissionModalAction(
  state: PermissionModalState,
  action: PermissionModalAction,
): PermissionModalState {
  switch (action.kind) {
    case "open": {
      const already = state.entries.some((entry) => entry.sessionId === action.entry.sessionId);
      const entries = already ? state.entries : [...state.entries, action.entry];
      return { ...state, open: true, phase: "idle", entries, saveFailed: false };
    }
    case "request":
      return { ...state, phase: "requesting" };
    case "request-finished":
      // 授权通过：关闭弹窗，不补发已展示的终局；未通过：等待用户重新检测或关闭任务提醒。
      return action.permissionAllowed
        ? { ...state, open: false, phase: "idle", entries: [] }
        : { ...state, phase: "request-done" };
    case "open-settings":
      return { ...state, phase: "opening-settings" };
    case "settings-opened":
      return { ...state, phase: "opened" };
    case "settings-failed":
      return { ...state, phase: "failed" };
    case "recheck":
      return action.permissionAllowed
        ? { ...state, open: false, phase: "idle", entries: [] }
        : { ...state, phase: "request-done" };
    case "close-notifications":
      return { ...state, phase: "closing-save" };
    case "close-save-finished":
      return { ...state, open: false, phase: "idle", entries: [] };
    case "close-save-failed":
      return { ...state, phase: "closing-save-failed", saveFailed: true };
  }
}
