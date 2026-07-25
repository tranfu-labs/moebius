import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function readPersona(name: string): Promise<string> {
  return fs.readFile(path.resolve("agents", `${name}.md`), "utf8");
}

describe("development team persona contracts", () => {
  it("binds dev verification evidence to a reproducible workspace snapshot", async () => {
    const persona = await readPersona("dev");

    expect(persona).toContain("可重算 workspace fingerprint");
    expect(persona).toContain("覆盖 tracked diff 与未跟踪交付文件内容");
    expect(persona).toContain("生成证据后如代码或交付文件变化");
  });

  it("makes implementation QA evidence-aware without defaulting to every full gate", async () => {
    const persona = await readPersona("qa");

    expect(persona).toContain("先校验证据绑定");
    expect(persona).toContain("做独立定向验证");
    expect(persona).toContain("MUST NOT 默认重跑全部测试、typecheck 和构建");
    expect(persona).toContain("涉及用户可见 UI 时必须走真实页面验证");
  });

  it("makes the manager hand off reusable evidence before requesting broader validation", async () => {
    const persona = await readPersona("dev-manager");

    expect(persona).toContain("验证快照、workspace fingerprint、门禁结果和验收证据");
    expect(persona).toContain("MUST NOT 默认要求对方机械重跑全部测试、typecheck 和构建");
  });
});
