import type { LocalRoundTerminalBus, LocalRoundTerminalEvent } from "../../src/local-console/round-terminal-event-bus.js";
import type { MacOsPermissionAdapter, MacOsNotificationPermissionSnapshot } from "./macos-permission-adapter.js";
import type { MacOsNotificationChannel, NotificationChannelResult } from "./notification-channel.js";
import type { TaskReminderLastClicked } from "./task-reminder-delivery-plan.js";
import {
  createPermissionModalState,
  planPermissionModalAction,
  type PermissionModalAction,
  type PermissionModalState,
} from "./permission-modal-plan.js";
import {
  decidePermissionAllowed,
  planChannelOutcome,
  planChannelStatus,
  planClickConsumption,
  planModalBridge,
  planPendingClick,
  planPermissionAfterRequest,
  planPermissionRefreshNeeded,
  planPreferenceGate,
  planPreferenceSaveOutcome,
  planSettingsOpenResult,
  planTerminalDelivery,
  type TaskReminderDeliveryPersistedState,
} from "./task-reminder-delivery-plan.js";

/**
 * 任务提醒投递 runtime（application）：订阅轮次终局事件 → domain 判定 → 系统通知/Dock
 * 或权限弹窗。通知失败只记录通道状态，不回滚终局事实。
 *
 * 投递状态持久化（QA #135 FQA-05）：已投递集合与待展示弹窗以 event_id 落盘，runtime
 * 重建（退出/崩溃后重启）恢复同一弹窗且不补发；通知点击载荷持久化供冷启动恢复定位。
 */

export interface TaskReminderDeliveryRuntimePorts {
  bus: LocalRoundTerminalBus;
  permission: MacOsPermissionAdapter;
  channel: MacOsNotificationChannel;
  preferenceEnabled(): Promise<boolean>;
  savePreference(enabled: boolean): Promise<void>;
  loadState(): Promise<TaskReminderDeliveryPersistedState>;
  saveState(state: TaskReminderDeliveryPersistedState): Promise<void>;
  /** 打开系统通知设置（弹窗「开启系统通知」在提交异常时改走此路径）。 */
  openSystemSettings(): Promise<boolean>;
  nowIso(): string;
}

export type TaskReminderChannelStatus = "ok" | "anomaly" | "unknown";

/** 通知点击定位载荷（application 侧形状；transport 层按结构透传）。 */
export interface TaskReminderClickedPayload {
  sessionId: string;
  roundId: number;
  terminalMessageId: number | null;
}

export interface TaskReminderDeliverySnapshot {
  modal: PermissionModalState;
  lastPermission: MacOsNotificationPermissionSnapshot | null;
  channelStatus: TaskReminderChannelStatus;
}

export class TaskReminderDeliveryRuntime {
  private modal: PermissionModalState = createPermissionModalState();
  private lastPermission: MacOsNotificationPermissionSnapshot | null = null;
  private channelStatus: TaskReminderChannelStatus = "unknown";
  /** 最近一次真实通知提交的结果；null 表示从未提交。权限读取可能是合成值，
   *  提交结果才是通道可用性的权威信号。 */
  private lastSubmitOutcome: "ok" | "anomaly" | null = null;
  private readonly delivered = new Set<string>();
  private lastClicked: TaskReminderLastClicked | null = null;
  private lastConsumedClickAt: string | null = null;
  private readonly stateChangedListeners = new Set<() => void>();
  private readonly loaded: Promise<void>;
  private readonly unsubscribe: () => void;

  constructor(private readonly ports: TaskReminderDeliveryRuntimePorts) {
    // 持久化状态装载（幂等）：恢复 delivered 集合与待展示弹窗。构造期即启动，
    // 避免惰性守卫条件；ready() 只是暴露同一个 promise。
    this.loaded = this.ports.loadState().then((state) => {
      for (const eventId of state.deliveredEventIds) {
        this.delivered.add(eventId);
      }
      this.lastClicked = state.lastClicked;
      this.lastConsumedClickAt = state.lastConsumedClickAt;
      let modal = createPermissionModalState();
      for (const entry of state.modalEntries) {
        modal = planPermissionModalAction(modal, { kind: "open", entry });
      }
      this.modal = modal;
    }).catch((error: unknown) => {
      console.error(`task-reminder delivery state load failed: ${String(error)}`);
    });
    this.unsubscribe = ports.bus.on((event) => {
      void this.handleTerminal(event);
    });
  }

  ready(): Promise<void> {
    return this.loaded;
  }

  /** 首次读取真实权限（总开关开启且从未读取时）；设置页/Onboarding 打开即读到当前值。 */
  async ensurePermission(): Promise<void> {
    await this.ready();
    const enabled = await this.ports.preferenceEnabled();
    const refresh = planPermissionRefreshNeeded(this.lastPermission, enabled);
    if (refresh.kind === "skip") {
      return;
    }
    this.lastPermission = await this.ports.permission.read();
  }

  dispose(): void {
    this.unsubscribe();
  }

  /** 投递状态变化订阅（弹窗打开/通道状态变化）；主进程据此推送渲染端重新读取。 */
  onStateChanged(listener: () => void): () => void {
    this.stateChangedListeners.add(listener);
    return () => {
      this.stateChangedListeners.delete(listener);
    };
  }

  private notifyStateChanged(): void {
    for (const listener of [...this.stateChangedListeners]) {
      try {
        listener();
      } catch (error) {
        console.error(`task-reminder state-changed listener failed: ${String(error)}`);
      }
    }
  }

  snapshot(): TaskReminderDeliverySnapshot {
    return {
      modal: this.modal,
      lastPermission: this.lastPermission,
      channelStatus: this.channelStatus,
    };
  }

  /** 未消费的通知点击载荷（冷启动恢复定位）；消费后返回 null。 */
  pendingClick(): TaskReminderClickedPayload | null {
    return planPendingClick(this.lastClicked, this.lastConsumedClickAt);
  }

  /** 记录一次通知点击（持久化载荷，供崩溃/重启后冷启动恢复）。 */
  async recordClick(payload: TaskReminderClickedPayload): Promise<void> {
    await this.ready();
    this.lastClicked = {
      ...payload,
      clickedAt: this.ports.nowIso(),
    };
    await this.persistState();
  }

  /** 标记最近一次点击已被 renderer 定位消费。 */
  async consumeClick(): Promise<void> {
    await this.ready();
    const consumedAt = planClickConsumption(this.lastClicked);
    if (consumedAt !== null) {
      this.lastConsumedClickAt = consumedAt;
      await this.persistState();
    }
  }

  private async persistState(): Promise<void> {
    const state: TaskReminderDeliveryPersistedState = {
      version: 1,
      deliveredEventIds: [...this.delivered],
      modalEntries: this.modal.entries,
      lastClicked: this.lastClicked,
      lastConsumedClickAt: this.lastConsumedClickAt,
    };
    try {
      await this.ports.saveState(state);
    } catch (error) {
      console.error(`task-reminder delivery state save failed: ${String(error)}`);
    }
  }

  private openModalFor(event: LocalRoundTerminalEvent): void {
    this.modal = planPermissionModalAction(this.modal, {
      kind: "open",
      entry: {
        eventId: event.eventId,
        sessionId: event.sessionId,
        title: event.conversationTitle,
        outcome: event.outcome,
      },
    });
  }

  private async handleTerminal(event: LocalRoundTerminalEvent): Promise<void> {
    await this.ready();
    const alreadyDelivered = this.delivered.has(event.eventId);
    const enabled = await this.ports.preferenceEnabled();
    const gate = planPreferenceGate(alreadyDelivered, enabled);
    if (gate.kind === "skip") {
      return;
    }
    this.delivered.add(event.eventId);

    const permission = await this.ports.permission.read();
    this.lastPermission = permission;
    const plan = planTerminalDelivery({ alreadyDelivered: false, enabled: true, permission, event });
    if (plan.kind === "skip") {
      return;
    }
    if (plan.kind === "modal") {
      this.channelStatus = planChannelStatus(permission, true, this.lastSubmitOutcome);
      this.modal = planPermissionModalAction(this.modal, { kind: "open", entry: plan.entry });
      await this.persistState();
      this.notifyStateChanged();
      return;
    }
    const result = await this.ports.channel.show({
      sessionId: event.sessionId,
      roundId: event.roundId,
      terminalMessageId: event.terminalMessageId,
      title: plan.title,
      body: plan.body,
    });
    this.lastSubmitOutcome = planChannelOutcome(result);
    this.channelStatus = planChannelOutcome(result);
    const outcome = planChannelOutcome(result);
    await this.persistState();
    if (outcome === "anomaly") {
      this.openModalFor(event);
      await this.persistState();
    }
    this.notifyStateChanged();
  }

  /** 权限弹窗操作入口（IPC 转发）；request/recheck 先读真实权限再推进状态机。 */
  async applyModalAction(action: PermissionModalAction): Promise<PermissionModalState> {
    await this.ready();
    const bridge = planModalBridge(action, this.lastSubmitOutcome);
    if (bridge.kind === "open-settings") {
      const ok = await this.ports.openSystemSettings();
      this.modal = planPermissionModalAction(this.modal, planSettingsOpenResult(ok));
      await this.persistState();
      this.notifyStateChanged();
      return { ...this.modal };
    }
    if (bridge.kind === "bridge-request") {
      const requested = await this.ports.permission.request();
      // 已拒绝 bundle 的 requestAuthorization 直接返回 error 1 且不弹窗；
      // 回读真实状态以显示「已拒绝 + 打开系统设置」而非「暂时无法检测」。
      const permission = await this.ports.permission.read()
        .then((reread) => planPermissionAfterRequest(requested, reread))
        .catch(() => requested);
      this.lastPermission = permission;
      const allowed = decidePermissionAllowed(permission);
      this.modal = planPermissionModalAction(this.modal, { kind: "request-finished", permissionAllowed: allowed });
      await this.persistState();
      this.notifyStateChanged();
      return { ...this.modal };
    }
    if (bridge.kind === "bridge-recheck") {
      const permission = await this.ports.permission.read();
      this.lastPermission = permission;
      const allowed = decidePermissionAllowed(permission);
      this.modal = planPermissionModalAction(this.modal, { kind: "recheck", permissionAllowed: allowed });
      await this.persistState();
      this.notifyStateChanged();
      return { ...this.modal };
    }
    if (bridge.kind === "save-close") {
      const saved = planPreferenceSaveOutcome(await this.savePreferenceGuarded(false));
      this.modal = saved.kind === "saved"
        ? planPermissionModalAction(this.modal, { kind: "close-save-finished" })
        : planPermissionModalAction(this.modal, { kind: "close-save-failed" });
      await this.persistState();
      this.notifyStateChanged();
      return { ...this.modal };
    }
    this.modal = planPermissionModalAction(this.modal, action);
    await this.persistState();
    this.notifyStateChanged();
    return { ...this.modal };
  }

  private async savePreferenceGuarded(enabled: boolean): Promise<boolean> {
    try {
      await this.ports.savePreference(enabled);
      return true;
    } catch (error) {
      console.error(`task-reminder preference save failed: ${String(error)}`);
      return false;
    }
  }

  /** 设置页「重新检查」通道状态：提交结果优先于权限读取，避免合成值冒充已恢复。 */
  async recheckChannel(): Promise<TaskReminderChannelStatus> {
    const permission = await this.ports.permission.read();
    this.lastPermission = permission;
    const enabled = await this.ports.preferenceEnabled();
    this.channelStatus = planChannelStatus(permission, enabled, this.lastSubmitOutcome);
    return this.channelStatus;
  }
}
