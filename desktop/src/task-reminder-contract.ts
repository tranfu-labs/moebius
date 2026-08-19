import type { MacOsNotificationPermissionSnapshot } from "./macos-permission-adapter.js";
import type { PermissionModalAction, PermissionModalState } from "./permission-modal-plan.js";

/** 任务提醒 IPC 通道与共享类型（preload 与主进程共用，不得引入 node 内置依赖）。 */
export const TASK_REMINDER_IPC_CHANNELS = {
  readState: "task-reminder:read-state",
  setEnabled: "task-reminder:set-enabled",
  modalAction: "task-reminder:modal-action",
  recheckChannel: "task-reminder:recheck-channel",
  openSystemSettings: "task-reminder:open-system-settings",
  clicked: "task-reminder:clicked",
  clickConsumed: "task-reminder:click-consumed",
  /** 投递状态变化推送（弹窗打开/通道状态变化），渲染端收到后重新 readState。 */
  stateChanged: "task-reminder:state-changed",
  /** 按当前会话状态刷新 Dock 角标（已读/归档/恢复后由渲染端触发）。 */
  refreshDock: "task-reminder:refresh-dock",
} as const;

export type TaskReminderChannelStatus = "ok" | "anomaly" | "unknown";

export interface TaskReminderReadState {
  enabled: boolean;
  permission: MacOsNotificationPermissionSnapshot | null;
  channelStatus: TaskReminderChannelStatus;
  modal: PermissionModalState;
  dockCount: number;
  /** 未消费的通知点击载荷；冷启动恢复定位用（QA #135 FQA-05）。 */
  pendingClick: TaskReminderClickedPayload | null;
}

export type TaskReminderModalAction = PermissionModalAction;

export interface TaskReminderClickedPayload {
  sessionId: string;
  roundId: number;
  terminalMessageId: number | null;
}
