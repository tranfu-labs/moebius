import { describe, expect, it } from "vitest";

import { stripLegacyOutcomeBoilerplate } from "./legacy-run-outcome-copy";

describe("legacy run outcome copy", () => {
  it("drops sentences the status bubble now states itself", () => {
    expect(stripLegacyOutcomeBoilerplate("这一步卡住了。你可以直接告诉主理人下一步怎么处理。")).toBe("");
    expect(stripLegacyOutcomeBoilerplate("这一步卡住了。你可以重试，或直接说话、换一个成员接手。")).toBe("");
    expect(stripLegacyOutcomeBoilerplate("你让这一步停下了。已经产生的文件改动会保留。")).toBe("");
    expect(stripLegacyOutcomeBoilerplate("这一步反复没跑起来，已经不再重试。你可以说点什么，或换一个成员接手。")).toBe("");
  });

  it("keeps a genuine engine diagnostic untouched", () => {
    expect(stripLegacyOutcomeBoilerplate("没有找到 Kimi CLI。请先安装 Kimi，然后重试。"))
      .toBe("没有找到 Kimi CLI。请先安装 Kimi，然后重试。");
  });

  it("shortens the tool-timeout sentence to the fact it carries", () => {
    expect(stripLegacyOutcomeBoilerplate("这一步的工具调用运行过久，已经停下。你可以重试，或换一个执行配置。"))
      .toBe("工具调用运行过久");
  });

  it("treats blank input as no description", () => {
    expect(stripLegacyOutcomeBoilerplate(null)).toBe("");
    expect(stripLegacyOutcomeBoilerplate("   ")).toBe("");
  });
});
