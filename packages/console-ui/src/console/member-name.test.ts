import { describe, expect, it } from "vitest";
import { translate } from "@/i18n";

import { resolveOperatorMemberName } from "./member-name";

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
