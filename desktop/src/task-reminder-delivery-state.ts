import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import {
  TASK_REMINDER_DELIVERY_STATE_VERSION,
  type TaskReminderDeliveryPersistedState,
  type TaskReminderLastClicked,
  type TaskReminderNotificationTargets,
} from "./task-reminder-delivery-plan.js";
import type { PermissionModalEntry } from "./permission-modal-plan.js";

/**
 * 任务提醒投递状态持久化（adapter）：以 event_id 记录已投递集合、待展示权限弹窗
 * 列表与通知点击载荷（QA #135 FQA-05）。
 *
 * 弹窗列表与 delivered 集合不能只在内存中：runtime 重建（退出/崩溃后重启）必须
 * 恢复同一弹窗且不补发；通知点击目标必须有可被冷启动恢复的持久载荷。损坏时回退
 * 为空状态（不丢用户偏好，只可能重弹一次待展示弹窗）。
 */

export type TaskReminderDeliveryStateDocument = TaskReminderDeliveryPersistedState;

const STATE_FILE_NAME = "task-reminder-delivery.json";

export function createTaskReminderDeliveryState(): TaskReminderDeliveryStateDocument {
  return {
    version: TASK_REMINDER_DELIVERY_STATE_VERSION,
    deliveredEventIds: [],
    modalEntries: [],
    notificationTargets: {},
    lastClicked: null,
    lastConsumedClickAt: null,
  };
}

export function resolveTaskReminderDeliveryStatePath(dataRoot: string): string {
  return path.join(dataRoot, ".state", STATE_FILE_NAME);
}

export interface TaskReminderDeliveryStateWriteOperations {
  mkdir(directory: string): Promise<void>;
  writeFile(filePath: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(filePath: string): Promise<void>;
  createTemporaryPath(statePath: string): string;
}

const defaultWriteOperations: TaskReminderDeliveryStateWriteOperations = {
  async mkdir(directory) {
    await fs.mkdir(directory, { recursive: true });
  },
  async writeFile(filePath, contents) {
    await fs.writeFile(filePath, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
  },
  async rename(from, to) {
    await fs.rename(from, to);
  },
  async remove(filePath) {
    await fs.rm(filePath, { force: true });
  },
  createTemporaryPath(statePath) {
    return `${statePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  },
};

function isPermissionModalEntry(value: unknown): value is PermissionModalEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PermissionModalEntry>;
  return typeof candidate.sessionId === "string"
    && typeof candidate.title === "string"
    && typeof candidate.eventId === "string"
    && (
      candidate.outcome === "completed"
      || candidate.outcome === "awaiting-user"
      || candidate.outcome === "no-new-content"
      || candidate.outcome === "silent-closeout"
    );
}

function isLastClicked(value: unknown): value is TaskReminderLastClicked {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TaskReminderLastClicked>;
  return typeof candidate.sessionId === "string"
    && typeof candidate.roundId === "number"
    && (candidate.terminalMessageId === null || typeof candidate.terminalMessageId === "number")
    && typeof candidate.clickedAt === "string";
}

function parseTaskReminderClickTarget(value: unknown): TaskReminderNotificationTargets[string] | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<TaskReminderNotificationTargets[string]>;
  if (typeof candidate.sessionId === "string"
    && typeof candidate.roundId === "number"
    && (candidate.terminalMessageId === null || typeof candidate.terminalMessageId === "number")) {
    return {
      sessionId: candidate.sessionId,
      roundId: candidate.roundId,
      terminalMessageId: candidate.terminalMessageId,
    };
  }
  return null;
}

function parseNotificationTargets(value: unknown): TaskReminderNotificationTargets {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const targets: TaskReminderNotificationTargets = {};
  for (const [notificationId, target] of Object.entries(value)) {
    const parsedTarget = parseTaskReminderClickTarget(target);
    if (parsedTarget !== null) {
      targets[notificationId] = parsedTarget;
    }
  }
  return targets;
}

export function parseTaskReminderDeliveryState(value: unknown): TaskReminderDeliveryStateDocument {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || (value as Partial<TaskReminderDeliveryStateDocument>).version !== TASK_REMINDER_DELIVERY_STATE_VERSION
  ) {
    return createTaskReminderDeliveryState();
  }
  const candidate = value as Partial<TaskReminderDeliveryStateDocument>;
  return {
    version: TASK_REMINDER_DELIVERY_STATE_VERSION,
    deliveredEventIds: Array.isArray(candidate.deliveredEventIds)
      ? candidate.deliveredEventIds.filter((id): id is string => typeof id === "string")
      : [],
    modalEntries: Array.isArray(candidate.modalEntries)
      ? candidate.modalEntries.filter(isPermissionModalEntry)
      : [],
    notificationTargets: parseNotificationTargets(candidate.notificationTargets),
    lastClicked: isLastClicked(candidate.lastClicked) ? candidate.lastClicked : null,
    lastConsumedClickAt: typeof candidate.lastConsumedClickAt === "string"
      ? candidate.lastConsumedClickAt
      : null,
  };
}

/**
 * 在 runtime 尚未创建时记录历史通知点击。读取后仍通过同一原子状态写入，
 * 使冷启动点击既可被 renderer 读取，也能在 local-console 就绪后由 runtime 恢复。
 */
export async function recordTaskReminderDeliveryClick(
  dataRoot: string,
  target: TaskReminderNotificationTargets[string],
  nowIso: string,
): Promise<void> {
  const state = await readTaskReminderDeliveryState(dataRoot);
  await saveTaskReminderDeliveryState(dataRoot, {
    ...state,
    lastClicked: {
      ...target,
      clickedAt: nowIso,
    },
  });
}

export async function readTaskReminderDeliveryState(dataRoot: string): Promise<TaskReminderDeliveryStateDocument> {
  try {
    const raw = await fs.readFile(resolveTaskReminderDeliveryStatePath(dataRoot), "utf8");
    return parseTaskReminderDeliveryState(JSON.parse(raw) as unknown);
  } catch {
    return createTaskReminderDeliveryState();
  }
}

export async function saveTaskReminderDeliveryState(
  dataRoot: string,
  state: TaskReminderDeliveryStateDocument,
  operations: TaskReminderDeliveryStateWriteOperations = defaultWriteOperations,
): Promise<void> {
  const statePath = resolveTaskReminderDeliveryStatePath(dataRoot);
  const directory = path.dirname(statePath);
  const temporaryPath = operations.createTemporaryPath(statePath);
  await operations.mkdir(directory);
  try {
    await operations.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
    await operations.rename(temporaryPath, statePath);
  } catch (error) {
    await operations.remove(temporaryPath).catch(() => undefined);
    throw error;
  }
}
