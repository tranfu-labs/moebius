import { describe, expect, it } from "vitest";

import { countProbedFiles, parseTestPlan, scopeOutcome } from "../src/testing/test-plan.js";

describe("parseTestPlan", () => {
  it("无参数是完整闸门，且必须拿锁", () => {
    const plan = parseTestPlan([]);

    expect(plan.mode).toBe("full");
    expect(plan.requiresLock).toBe(true);
    expect(plan.preflightCommands).toEqual([
      { label: "import boundaries", args: ["check:boundaries"] },
    ]);
    expect(plan.commands.map((command) => command.label)).toEqual([
      "root (除慢测)",
      "root (慢测)",
      "desktop",
      "console-ui",
    ]);
  });

  it("完整闸门保持串行——并行会让等真实 I/O 的断言互相干扰", () => {
    const plan = parseTestPlan([]);
    const rootCommands = plan.commands.slice(0, 2);

    for (const command of rootCommands) {
      expect(command.args).toContain("--maxWorkers=1");
      expect(command.args).toContain("--no-file-parallelism");
    }
  });

  it("完整闸门把慢测单独拆一轮跑", () => {
    const plan = parseTestPlan([]);

    expect(plan.commands[0].args).toContain("--exclude");
    expect(plan.commands[0].args).toContain("tests/local-console.test.ts");
    expect(plan.commands[1].args).toContain("tests/local-console.test.ts");
  });

  it("--scope 不带基线时按未提交改动算，且不拿锁", () => {
    const plan = parseTestPlan(["--scope"]);

    expect(plan.mode).toBe("scope");
    expect(plan.requiresLock).toBe(false);
    for (const command of plan.commands) {
      expect(command.args).toContain("--changed");
    }
    // 没有基线参数时不能凭空塞一个进去。
    expect(plan.commands[0].args.filter((arg) => arg === "--changed")).toHaveLength(1);
    expect(plan.commands[0].args).not.toContain("origin/main");
  });

  it("--scope <base> 把基线透传给 vitest", () => {
    const plan = parseTestPlan(["--scope", "origin/main"]);

    expect(plan.mode).toBe("scope");
    for (const command of plan.commands) {
      const index = command.args.indexOf("--changed");
      expect(index).toBeGreaterThanOrEqual(0);
      expect(command.args[index + 1]).toBe("origin/main");
    }
  });

  it("--scope 覆盖三个 workspace，漏一个就等于闸门有盲区", () => {
    const plan = parseTestPlan(["--scope"]);

    const labels = plan.commands.map((command) => command.label);
    expect(labels).toEqual(["root (scope)", "desktop (scope)", "console-ui (scope)"]);
  });

  it("完整与 scope 闸门都先检查 import 边界，直通定向测试不重复收税", () => {
    expect(parseTestPlan([]).preflightCommands.map((command) => command.label))
      .toEqual(["import boundaries"]);
    expect(parseTestPlan(["--scope"]).preflightCommands.map((command) => command.label))
      .toEqual(["import boundaries"]);
    expect(parseTestPlan(["tests/foo.test.ts"]).preflightCommands).toEqual([]);
  });

  it("--scope 跑完必须提示它不是全量闸门", () => {
    const plan = parseTestPlan(["--scope"]);

    expect(plan.footer).toBeDefined();
    expect(plan.footer).toContain("不等于全量通过");
    expect(plan.footer).toContain("pnpm test");
  });

  it("--scope 的提示里带上实际基线", () => {
    expect(parseTestPlan(["--scope", "origin/main"]).footer).toContain("origin/main");
    expect(parseTestPlan(["--scope"]).footer).toContain("未提交改动");
  });

  it("--scope 后跟选项时不把选项误当基线", () => {
    const plan = parseTestPlan(["--scope", "--reporter=dot"]);

    const index = plan.commands[0].args.indexOf("--changed");
    expect(plan.commands[0].args[index + 1]).not.toBe("--reporter=dot");
    expect(plan.footer).toContain("未提交改动");
  });

  it("带文件参数走原有的直通行为，不拿锁", () => {
    const plan = parseTestPlan(["tests/foo.test.ts", "tests/bar.test.ts"]);

    expect(plan.mode).toBe("direct");
    expect(plan.requiresLock).toBe(false);
    expect(plan.commands).toHaveLength(1);
    expect(plan.commands[0].args).toEqual([
      "exec",
      "vitest",
      "run",
      "tests/foo.test.ts",
      "tests/bar.test.ts",
    ]);
  });

  it("只有完整闸门需要跨 worktree 互斥", () => {
    expect(parseTestPlan([]).requiresLock).toBe(true);
    expect(parseTestPlan(["--scope"]).requiresLock).toBe(false);
    expect(parseTestPlan(["tests/foo.test.ts"]).requiresLock).toBe(false);
  });

  it("scope 的每个 workspace 都带探测命令，否则无从区分「没跑」和「跑过且通过」", () => {
    for (const command of parseTestPlan(["--scope"]).commands) {
      expect(command.probeArgs).toBeDefined();
      expect(command.probeArgs).toContain("list");
      expect(command.probeArgs).toContain("--filesOnly");
    }
  });

  it("完整闸门与直通模式不需要探测", () => {
    for (const plan of [parseTestPlan([]), parseTestPlan(["tests/foo.test.ts"])]) {
      for (const command of plan.commands) {
        expect(command.probeArgs).toBeUndefined();
      }
    }
  });
});

describe("countProbedFiles", () => {
  it("按非空行计数", () => {
    expect(countProbedFiles("tests/a.test.ts\ntests/b.test.ts\n")).toBe(2);
  });

  it("空输出是 0 个文件", () => {
    expect(countProbedFiles("")).toBe(0);
    expect(countProbedFiles("\n  \n")).toBe(0);
  });
});

describe("scopeOutcome", () => {
  it("一个文件都没命中时判失败——静默的绿会被误读成「改动已验证」", () => {
    const outcome = scopeOutcome([0, 0, 0], "未提交改动");

    expect(outcome.failed).toBe(true);
    expect(outcome.totalFiles).toBe(0);
    expect(outcome.message).toContain("一个测试都没跑");
  });

  it("命中文件时汇总总数并放行", () => {
    const outcome = scopeOutcome([3, 0, 2], "origin/main");

    expect(outcome.failed).toBe(false);
    expect(outcome.totalFiles).toBe(5);
  });

  it("只有一个 workspace 命中也算有效——改动本就常只涉及一个包", () => {
    expect(scopeOutcome([0, 1, 0], "未提交改动").failed).toBe(false);
  });

  it("失败提示里带上基线，方便判断是不是基线选错了", () => {
    expect(scopeOutcome([0], "origin/main").message).toContain("origin/main");
  });
});
