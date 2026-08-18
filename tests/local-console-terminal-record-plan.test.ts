import { describe, expect, it } from "vitest";

import {
  planTerminalProcessSteps,
} from "../src/local-console/terminal-record-plan.js";
import type { LocalRunActivity } from "../src/local-console/run-activity.js";

function step(overrides: Partial<LocalRunActivity> & Pick<LocalRunActivity, "kind" | "phase" | "object">): LocalRunActivity {
  return {
    cursor: 1,
    action: `${overrides.phase === "completed" ? "已完成" : "正在"}${
      overrides.kind === "command"
        ? "运行命令"
        : overrides.kind === "thinking"
          ? "思考"
          : overrides.kind === "search"
            ? "搜索"
            : overrides.kind === "read"
              ? "读取文件"
              : overrides.kind === "edit"
                ? "修改文件"
                : "使用工具"
    }`,
    occurredAt: "2026-08-09T05:32:00.000Z",
    ...overrides,
  };
}

describe("terminal process step planning", () => {
  it("strips the running/completed prefix from step titles (PRD 验收 47)", () => {
    const mapped = planTerminalProcessSteps([
      step({ kind: "command", phase: "running", object: "pnpm test" }),
      step({ kind: "tool", phase: "completed", object: "read_file" }),
    ]);

    expect(mapped.map((entry) => entry.title)).toEqual(["运行命令", "使用工具"]);
  });

  it("maps error to the failed status and carries bounded output and remaining count", () => {
    const mapped = planTerminalProcessSteps([
      step({
        kind: "command",
        phase: "completed",
        object: "pnpm test",
        error: "file not found",
        output: "error: missing",
        outputRemainingLines: 4,
        input: "pnpm test --filter x",
      }),
    ]);

    expect(mapped[0]).toMatchObject({
      status: "failed",
      error: "file not found",
      output: "error: missing",
      outputRemainingLines: 4,
      input: "pnpm test --filter x",
    });
  });

  it("keeps old records without the new fields as running/done without fabrication", () => {
    const mapped = planTerminalProcessSteps([
      step({ kind: "tool", phase: "running", object: "read_file" }),
      step({ kind: "tool", phase: "completed", object: "edit_file" }),
    ]);

    expect(mapped[0]).toMatchObject({ status: "running" });
    expect("input" in mapped[0]!).toBe(false);
    expect("output" in mapped[0]!).toBe(false);
    expect(mapped[1]).toMatchObject({ status: "done" });
    expect("error" in mapped[1]!).toBe(false);
  });

  it("skips progress entries and unknown kinds", () => {
    const mapped = planTerminalProcessSteps([
      step({ kind: "progress", phase: "running", object: "正文" }),
      step({ kind: "command", phase: "completed", object: "pnpm test" }),
    ]);

    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.kind).toBe("command");
  });

  it("maps file kinds onto the shared file step kind", () => {
    const mapped = planTerminalProcessSteps([
      step({ kind: "read", phase: "completed", object: "a.ts" }),
      step({ kind: "edit", phase: "completed", object: "b.ts" }),
    ]);

    expect(mapped.map((entry) => entry.kind)).toEqual(["file", "file"]);
  });
});
