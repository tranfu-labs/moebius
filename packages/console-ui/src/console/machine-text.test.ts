import { describe, expect, it } from "vitest";

import { translate } from "@/i18n";

import {
  containsMachineText,
  machineTextPlaceholders,
  sanitizeMachineText,
} from "./machine-text";

const zhT: Parameters<typeof machineTextPlaceholders>[0] = (key, values) =>
  translate("zh-CN", key, values);
const enT: Parameters<typeof machineTextPlaceholders>[0] = (key, values) =>
  translate("en", key, values);
const sanitizeZh = (value: string): string => {
  const placeholders = machineTextPlaceholders(zhT);
  return sanitizeMachineText(value, placeholders.machine, placeholders);
};

describe("machine text filtering", () => {
  it.each([
    "cwd=/Users/wing/project runDir=/tmp/run-1",
    "数据库在 /home/user/.state/local-console.sqlite",
    "workspaceCwd: /var/folders/aa/workdir sourceMessageId=42",
    "sessionId=local:2026-07-22 runId=local-run-1",
    "C:\\Users\\wing\\project\\state.sqlite",
    "dead-letter:max-retries",
  ])("hides paths, cwd, run directories, and internal ids: %s", (source) => {
    const rendered = sanitizeZh(source);
    expect(rendered).not.toContain("/Users/");
    expect(rendered).not.toContain("/home/");
    expect(rendered).not.toContain("/tmp/");
    expect(rendered).not.toContain("local:");
    expect(rendered).not.toContain("dead-letter");
    expect(containsMachineText(source)).toBe(true);
  });

  it("keeps normal Chinese conversation text", () => {
    const source = "正在补空状态验收语句，你也可以换一个成员接手。";
    expect(sanitizeZh(source)).toBe(source);
    expect(containsMachineText(source)).toBe(false);
  });

  it("treats plain strings as visible text and hides every absolute path", () => {
    const source = "原始文件还在 /Users/wing/private.txt。";
    expect(sanitizeZh(source)).toBe("原始文件还在 [路径已隐藏]");
  });

  it("uses English placeholders without leaking Chinese interface copy", () => {
    const placeholders = machineTextPlaceholders(enT);
    const rendered = sanitizeMachineText(
      "/Users/wing/project dead-letter:42",
      placeholders.machine,
      placeholders,
    );

    expect(rendered).toContain("[Path hidden]");
    expect(rendered).toContain("[Internal identifier hidden]");
    expect(rendered).not.toMatch(/\p{Script=Han}/u);
  });
});
