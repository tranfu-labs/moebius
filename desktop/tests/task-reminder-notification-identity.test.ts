import { describe, expect, it } from "vitest";

import {
  createTaskReminderNotificationId,
  decodeTaskReminderNotificationId,
  TASK_REMINDER_NOTIFICATION_GROUP_ID,
  TASK_REMINDER_NOTIFICATION_ID_PREFIX,
} from "../src/task-reminder-notification-identity.js";

describe("task-reminder notification identity", () => {
  it("同一 eventId 生成跨重启稳定的独立通知 id，并能解码", () => {
    const eventId = "session:round/terminal?session=一:7";
    const notificationId = createTaskReminderNotificationId(eventId);

    expect(notificationId).toBe(createTaskReminderNotificationId(eventId));
    expect(notificationId.startsWith(TASK_REMINDER_NOTIFICATION_ID_PREFIX)).toBe(true);
    expect(decodeTaskReminderNotificationId(notificationId)).toBe(eventId);
    expect(TASK_REMINDER_NOTIFICATION_GROUP_ID).toBe("moebius-task-reminder");
  });

  it("非法或非任务提醒 id 安全降级为 null", () => {
    expect(decodeTaskReminderNotificationId("other-notification")).toBeNull();
    expect(decodeTaskReminderNotificationId(TASK_REMINDER_NOTIFICATION_ID_PREFIX)).toBeNull();
    expect(decodeTaskReminderNotificationId(`${TASK_REMINDER_NOTIFICATION_ID_PREFIX}%E0%A4%A`)).toBeNull();
  });
});
