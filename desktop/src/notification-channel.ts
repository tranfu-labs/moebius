import { Notification, app } from "electron/main";

/**
 * 系统通知与 Dock 角标通道（Electron 主进程）。
 *
 * spike 结论：正式/adhoc 签名下 Notification.show() 触发 show；未签名无法启动；
 * 系统设置入口用 shell.openExternal（已在 spike 验证）。通知失败通过 failed 事件
 * 映射为「暂时无法发送系统通知」通道状态，不伪造送达。
 */

export type NotificationChannelResult =
  | { ok: true }
  | { ok: false; reason: "failed" | "unsupported" };

export interface NotificationChannelClickPayload {
  sessionId: string;
  roundId: number;
  terminalMessageId: number | null;
}

export type NotificationChannelClickListener = (payload: NotificationChannelClickPayload) => void;

export interface MacOsNotificationChannelPorts {
  nowIso(): string;
}

export class MacOsNotificationChannel {
  private readonly clickListeners = new Set<NotificationChannelClickListener>();

  constructor(private readonly ports: MacOsNotificationChannelPorts) {}

  onNotificationClick(listener: NotificationChannelClickListener): () => void {
    this.clickListeners.add(listener);
    return () => {
      this.clickListeners.delete(listener);
    };
  }

  show(input: {
    sessionId: string;
    roundId: number;
    terminalMessageId: number | null;
    title: string;
    body: string;
  }): NotificationChannelResult {
    if (!Notification.isSupported()) {
      return { ok: false, reason: "unsupported" };
    }
    const notification = new Notification({
      title: input.title,
      body: input.body,
    });
    notification.on("failed", (_event, error) => {
      console.error(`task-reminder notification failed: ${String(error)}`);
    });
    notification.on("click", () => {
      for (const listener of [...this.clickListeners]) {
        try {
          listener({
            sessionId: input.sessionId,
            roundId: input.roundId,
            terminalMessageId: input.terminalMessageId,
          });
        } catch (error) {
          console.error(`task-reminder click listener failed: ${String(error)}`);
        }
      }
    });
    notification.show();
    void this.ports.nowIso();
    return { ok: true };
  }

  setDockBadge(count: number | null): void {
    if (app.dock === undefined) {
      return;
    }
    if (count === null || count <= 0) {
      app.dock.setBadge("");
      return;
    }
    app.dock.setBadge(String(count));
  }
}
