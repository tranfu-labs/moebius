import type { LocalRoundTerminalOutcome } from "./round-closeout-plan.js";

/**
 * 内部类型化事件总线：轮次终局事件。
 *
 * 收束事实成功落盘后由 runtime 发布；消费者（Dock 计数、系统通知、权限弹窗）订阅。
 * 不开放用户脚本 Hook；同一 event_id 至多投递一次（去重由 runtime 持久化）。
 */
export interface LocalRoundTerminalEvent {
  eventId: string;
  sessionId: string;
  roundId: number;
  outcome: LocalRoundTerminalOutcome;
  terminalMessageId: number | null;
  conversationTitle: string;
  occurredAt: string;
}

export type LocalRoundTerminalListener = (event: LocalRoundTerminalEvent) => void;

export class LocalRoundTerminalBus {
  private readonly listeners = new Set<LocalRoundTerminalListener>();

  on(listener: LocalRoundTerminalListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: LocalRoundTerminalEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        // 消费者失败不影响会话终局事实；由消费者自行负责降级。
        console.error(`round-terminal-bus listener failed: ${String(error)}`);
      }
    }
  }
}
