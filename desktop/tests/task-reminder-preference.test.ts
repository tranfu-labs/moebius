import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  parseTaskReminderPreference,
  readTaskReminderPreference,
  saveTaskReminderPreference,
  type TaskReminderPreferenceWriteOperations,
} from "../src/task-reminder-preference.js";

describe("task-reminder preference（任务提醒总开关持久化）", () => {
  it("无偏好文件：默认开启", async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "moebius-preference-"));
    expect(await readTaskReminderPreference(dataRoot)).toBe(true);
  });

  it("损坏 JSON / 版本不符 / 字段非法：一律回退默认开启", async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "moebius-preference-"));
    const stateDir = path.join(dataRoot, ".state");
    fs.mkdirSync(stateDir, { recursive: true });
    const file = path.join(stateDir, "notification-preference.json");
    fs.writeFileSync(file, "{not-json", "utf8");
    expect(await readTaskReminderPreference(dataRoot)).toBe(true);
    fs.writeFileSync(file, JSON.stringify({ version: 999, enabled: false }), "utf8");
    expect(await readTaskReminderPreference(dataRoot)).toBe(true);
    fs.writeFileSync(file, JSON.stringify({ version: 1, enabled: "yes" }), "utf8");
    expect(await readTaskReminderPreference(dataRoot)).toBe(true);
  });

  it("原子保存：关闭后重读为 false，再次保存开启后重读为 true", async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "moebius-preference-"));
    await saveTaskReminderPreference(dataRoot, false);
    expect(await readTaskReminderPreference(dataRoot)).toBe(false);
    await saveTaskReminderPreference(dataRoot, true);
    expect(await readTaskReminderPreference(dataRoot)).toBe(true);
    // 原子写：目录内不存在残留临时文件。
    const leftovers = fs.readdirSync(path.join(dataRoot, ".state"))
      .filter((name) => name.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("保存失败：向上抛错，调用方回退（不冒充成功）", async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "moebius-preference-"));
    const failing: TaskReminderPreferenceWriteOperations = {
      async mkdir() {},
      async writeFile() {},
      async rename() {
        throw new Error("rename failed");
      },
      async remove() {},
      createTemporaryPath(preferencePath) {
        return `${preferencePath}.tmp`;
      },
    };
    await expect(saveTaskReminderPreference(dataRoot, false, failing)).rejects.toThrow("rename failed");
  });
});
