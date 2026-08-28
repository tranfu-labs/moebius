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
export type NotificationHistoryClickListener = (notificationId: string) => void;

export class MacOsNotificationChannel {
  private readonly clickListeners = new Set<NotificationChannelClickListener>();
  private readonly historyClickListeners = new Set<NotificationHistoryClickListener>();
  /** getHistory 返回的是与通知中心相连的 live object，必须保留引用直到应用退出。 */
  private readonly restoredNotifications = new Map<string, Notification>();
  private historyRestorePromise: Promise<void> | null = null;

  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  onNotificationClick(listener: NotificationChannelClickListener): () => void {
    this.clickListeners.add(listener);
    return () => {
      this.clickListeners.delete(listener);
    };
  }

  onNotificationHistoryClick(listener: NotificationHistoryClickListener): () => void {
    this.historyClickListeners.add(listener);
    return () => {
      this.historyClickListeners.delete(listener);
    };
  }

  /**
   * 只在 macOS 查询一次通知中心历史，并为每个 id 只注册一次 click listener。
   * 查询失败、空结果或不支持时只记录诊断信息，不产生伪造点击。
   */
  restoreHistory(knownNotificationIds?: ReadonlySet<string>): Promise<void> {
    if (this.historyRestorePromise !== null) {
      return this.historyRestorePromise;
    }
    if (this.platform !== "darwin") {
      this.historyRestorePromise = Promise.resolve();
      return this.historyRestorePromise;
    }
    this.historyRestorePromise = this.loadHistory(knownNotificationIds);
    return this.historyRestorePromise;
  }

  private async loadHistory(knownNotificationIds?: ReadonlySet<string>): Promise<void> {
    if (typeof Notification.getHistory !== "function") {
      console.error("task-reminder notification history unsupported");
      return;
    }
    try {
      const notifications = await Notification.getHistory();
      if (notifications.length === 0) {
        console.error("task-reminder notification history is empty");
      }
      for (const notification of notifications) {
        const notificationId = notification.id;
        if (
          notificationId.length === 0
          || this.restoredNotifications.has(notificationId)
          || knownNotificationIds !== undefined && !knownNotificationIds.has(notificationId)
        ) {
          continue;
        }
        this.restoredNotifications.set(notificationId, notification);
        notification.on("click", () => {
          for (const listener of [...this.historyClickListeners]) {
            try {
              listener(notificationId);
            } catch (error) {
              console.error(`task-reminder history click listener failed: ${String(error)}`);
            }
          }
        });
      }
    } catch (error) {
      console.error(`task-reminder notification history failed: ${String(error)}`);
    }
  }

  show(input: {
    sessionId: string;
    roundId: number;
    terminalMessageId: number | null;
    title: string;
    body: string;
    notificationId: string;
    groupId: string;
  }): Promise<NotificationChannelResult> {
    if (!Notification.isSupported()) {
      return Promise.resolve({ ok: false, reason: "unsupported" });
    }
    return new Promise((resolve) => {
      const notification = new Notification({
        id: input.notificationId,
        groupId: input.groupId,
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
