import { ipcMain, type IpcMain, type Shell } from "electron";

import type { DesktopWindowRuntime } from "./desktop-window-runtime.js";
import type { PermissionModalAction, PermissionModalState } from "./permission-modal-plan.js";
import {
  TASK_REMINDER_IPC_CHANNELS,
  type TaskReminderChannelStatus,
  type TaskReminderClickedPayload,
  type TaskReminderReadState,
} from "./task-reminder-contract.js";

/**
 * 任务提醒 IPC（adapter / 纯 transport）：编解码渲染进程请求并转发到注入的
 * 投递 runtime 端口；不包含业务判定。
 */

export interface TaskReminderDeliveryPorts {
  readState(): Promise<TaskReminderReadState>;
  setEnabled(enabled: boolean): Promise<{ ok: boolean }>;
  applyModalAction(action: PermissionModalAction): Promise<{ ok: boolean; state: PermissionModalState | null }>;
  recheckChannel(): Promise<TaskReminderChannelStatus>;
  openSystemSettings(): Promise<{ ok: boolean }>;
  /** 记录一次通知点击（持久化载荷）。 */
  recordClick(payload: TaskReminderClickedPayload): Promise<void>;
  /** 标记最近一次点击已被 renderer 定位消费。 */
  consumeClick(): Promise<void>;
}

export function registerTaskReminderIpc(input: {
  ipcMain: IpcMain;
  windows: DesktopWindowRuntime;
  shell: Shell;
  delivery: TaskReminderDeliveryPorts;
  onNotificationClick(listener: (payload: {
    sessionId: string;
    roundId: number;
    terminalMessageId: number | null;
  }) => void): void;
}): void {
  input.onNotificationClick((payload) => {
    void input.delivery.recordClick(payload);
    input.windows.focusMainWindow();
    for (const target of input.windows.getBroadcastTargets()) {
      target.send(TASK_REMINDER_IPC_CHANNELS.clicked, payload);
    }
  });

  input.ipcMain.handle(TASK_REMINDER_IPC_CHANNELS.readState, async () => await input.delivery.readState());

  input.ipcMain.handle(TASK_REMINDER_IPC_CHANNELS.setEnabled, async (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") {
      return { ok: false };
    }
    return await input.delivery.setEnabled(enabled);
  });

  input.ipcMain.handle(TASK_REMINDER_IPC_CHANNELS.modalAction, async (_event, action: PermissionModalAction) =>
    await input.delivery.applyModalAction(action));

  input.ipcMain.handle(TASK_REMINDER_IPC_CHANNELS.recheckChannel, async () =>
    await input.delivery.recheckChannel());

  input.ipcMain.handle(TASK_REMINDER_IPC_CHANNELS.openSystemSettings, async () =>
    await input.delivery.openSystemSettings());

  input.ipcMain.handle(TASK_REMINDER_IPC_CHANNELS.clickConsumed, async () => {
    await input.delivery.consumeClick();
    return { ok: true };
  });

  void input.shell;
}
