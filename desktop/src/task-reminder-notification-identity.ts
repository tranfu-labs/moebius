/**
 * 任务提醒通知身份（domain）：通知中心历史对象只可靠地恢复 id，
 * 因此 id 必须能跨进程、跨重启稳定映射回终局事件。
 */

export const TASK_REMINDER_NOTIFICATION_ID_PREFIX = "moebius-task-reminder-";
export const TASK_REMINDER_NOTIFICATION_GROUP_ID = "moebius-task-reminder";

export function createTaskReminderNotificationId(eventId: string): string {
  return `${TASK_REMINDER_NOTIFICATION_ID_PREFIX}${encodeURIComponent(eventId)}`;
}

export function decodeTaskReminderNotificationId(notificationId: string): string | null {
  if (!notificationId.startsWith(TASK_REMINDER_NOTIFICATION_ID_PREFIX)) {
    return null;
  }
  const encodedEventId = notificationId.slice(TASK_REMINDER_NOTIFICATION_ID_PREFIX.length);
  if (encodedEventId.length === 0) {
    return null;
  }
  try {
    const eventId = decodeURIComponent(encodedEventId);
    return eventId.length === 0 ? null : eventId;
  } catch {
    return null;
  }
}
