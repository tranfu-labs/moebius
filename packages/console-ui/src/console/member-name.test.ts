import { describe, expect, it } from "vitest";

import { resolveOperatorMemberName } from "./member-name";

const customMembers = [
  { slug: "plan-supervisor", displayName: "方案监督者" },
  { slug: "plan-executor", displayName: "方案执行者" },
  { slug: "unnamed-reviewer", displayName: "" },
];

describe("resolveOperatorMemberName", () => {
  it("prefers the session snapshot and keeps custom members distinct", () => {
    expect(resolveOperatorMemberName("plan-supervisor", customMembers)).toBe("方案监督者");
    expect(resolveOperatorMemberName("plan-executor", customMembers)).toBe("方案执行者");
    expect(resolveOperatorMemberName("unnamed-reviewer", customMembers)).toBe("@unnamed-reviewer");
  });

  it("uses built-in compatibility only when no session projection exists", () => {
    expect(resolveOperatorMemberName("dev")).toBe("开发");
    expect(resolveOperatorMemberName("qa")).toBe("测试");
    expect(resolveOperatorMemberName("dev", customMembers, "成员未知")).toBe("成员未知");
    expect(resolveOperatorMemberName(null, customMembers, "成员未知")).toBe("成员未知");
  });
});
