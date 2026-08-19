import { Notification, app } from "electron/main";

/**
 * 系统通知与 Dock 角标通道（Electron 主进程）。
 *
 * 提交结果异步三态（show / failed / 超时）：被 usernoted 拒绝时 show/failed 事件
 * 都不会触发（本机 26.5.2 实测），由超时兜底闭合反馈回路，映射为「暂时无法发送
 * 系统通知」通道状态，不伪造送达。
 */

export type NotificationChannelResult =
  | { ok: true }
  | { ok: false; reason: "failed" | "unsupported" | "timeout" };

/**
 * 提交结果超时窗口：macOS usernoted 拒绝（legacy 混合、签名验证失败等）时
 * show/failed 事件都不会触发（本机 26.5.2 实测），必须由超时兜底闭合反馈回路。
 */
export const NOTIFICATION_SUBMIT_TIMEOUT_MS = 8_000;

export interface NotificationChannelClickPayload {
  sessionId: string;
  roundId: number;
  terminalMessageId: number | null;
}

export type NotificationChannelClickListener = (payload: NotificationChannelClickPayload) => void;

export class MacOsNotificationChannel {
  private readonly clickListeners = new Set<NotificationChannelClickListener>();

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
  }): Promise<NotificationChannelResult> {
    if (!Notification.isSupported()) {
      return Promise.resolve({ ok: false, reason: "unsupported" });
    }
    return new Promise((resolve) => {
      const notification = new Notification({
        title: input.title,
        body: input.body,
      });
      let settled = false;
      const settle = (result: NotificationChannelResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      // 被 usernoted 拒绝时 show/failed 都不会触发（本机实测），超时兜底保证
      // 投递器总能拿到结论并映射为通道异常，绝不静默丢失。
      const timer = setTimeout(() => {
        settle({ ok: false, reason: "timeout" });
      }, NOTIFICATION_SUBMIT_TIMEOUT_MS);
      notification.on("failed", (_event, error) => {
        console.error(`task-reminder notification failed: ${String(error)}`);
        settle({ ok: false, reason: "failed" });
      });
      notification.on("show", () => {
        settle({ ok: true });
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
    });
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
