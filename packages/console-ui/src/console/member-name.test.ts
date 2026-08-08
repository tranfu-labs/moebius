import { describe, expect, it } from "vitest";
import { translate } from "@/i18n";

import {
  resolveOperatorMemberEngine,
  resolveOperatorMemberName,
  resolveOperatorMemberPortrait,
} from "./member-name";

const customMembers = [
  { slug: "plan-supervisor", displayName: "方案监督者" },
  { slug: "plan-executor", displayName: "方案执行者" },
  { slug: "unnamed-reviewer", displayName: "" },
];
const zhT: Parameters<typeof resolveOperatorMemberName>[2] = (key, values) =>
  translate("zh-CN", key, values);
const enT: Parameters<typeof resolveOperatorMemberName>[2] = (key, values) =>
  translate("en", key, values);

describe("resolveOperatorMemberName", () => {
  it("prefers the session snapshot and keeps custom members distinct", () => {
    expect(resolveOperatorMemberName("plan-supervisor", customMembers, zhT)).toBe("方案监督者");
    expect(resolveOperatorMemberName("plan-executor", customMembers, zhT)).toBe("方案执行者");
    expect(resolveOperatorMemberName("unnamed-reviewer", customMembers, zhT)).toBe("@unnamed-reviewer");
  });

  it("uses built-in compatibility only when no session projection exists", () => {
    expect(resolveOperatorMemberName("dev", [], zhT)).toBe("开发");
    expect(resolveOperatorMemberName("qa", [], zhT)).toBe("测试");
    expect(resolveOperatorMemberName("dev", customMembers, zhT, "成员未知")).toBe("成员未知");
    expect(resolveOperatorMemberName(null, customMembers, zhT, "成员未知")).toBe("成员未知");
  });

  it("localizes built-in and default member names in English", () => {
    const names = [
      resolveOperatorMemberName("dev", [], enT),
      resolveOperatorMemberName("qa", [], enT),
      resolveOperatorMemberName(null, [], enT),
    ];

    expect(names).toEqual(["Developer", "QA", "Collaborator"]);
    expect(names.join(" ")).not.toMatch(/\p{Script=Han}/u);
  });
});

describe("resolveOperatorMemberPortrait", () => {
  it("resolves the chosen face from the roster and falls back to the default when absent", () => {
    const roster = [
      { slug: "plan-supervisor", displayName: "方案监督者", portraitId: "cat-12" },
      { slug: "plan-executor", displayName: "方案执行者", portraitId: null },
      { slug: "unnamed-reviewer", displayName: "" },
    ];

    expect(resolveOperatorMemberPortrait("plan-supervisor", roster)).toBe("cat-12");
    expect(resolveOperatorMemberPortrait("plan-executor", roster)).toBeNull();
    expect(resolveOperatorMemberPortrait("unnamed-reviewer", roster)).toBeUndefined();
    expect(resolveOperatorMemberPortrait("missing", roster)).toBeUndefined();
    expect(resolveOperatorMemberPortrait(null, roster)).toBeUndefined();
  });

  it("carries the engine mark alongside the face for the timeline badge", () => {
    const roster = [
      { slug: "dev", displayName: "开发", engine: { cli: "kimi" as const } },
    ];
    expect(resolveOperatorMemberEngine("dev", roster)).toEqual({ cli: "kimi" });
    expect(resolveOperatorMemberEngine("missing", roster)).toBeUndefined();
  });
});
