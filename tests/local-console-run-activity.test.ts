import { describe, expect, it } from "vitest";

import {
  chooseLatestRunActivity,
  projectAgentProgressActivity,
  projectStructuredRunActivity,
} from "../src/local-console/run-activity.js";

describe("local run activity projection", () => {
  it("projects a safe command without arguments, paths, ids, or output", () => {
    const activity = projectStructuredRunActivity({
      type: "item.started",
      item: {
        type: "command_execution",
        command: "pnpm test --filter /private/work/private runId=run-secret",
        output: "secret output",
      },
    }, 3, "2026-07-26T10:00:00.000Z");

    expect(activity).toMatchObject({
      cursor: 3,
      kind: "command",
      phase: "running",
      action: "正在运行命令",
      object: "pnpm test",
    });
    expect(JSON.stringify(activity)).not.toMatch(/Users|run-secret|secret output/u);
  });

  it("uses basenames for file activity", () => {
    expect(projectStructuredRunActivity({
      type: "item.completed",
      item: { type: "file_change", path: "/private/work/src/run-block.tsx", status: "completed" },
    }, 4, "2026-07-26T10:00:01.000Z")).toMatchObject({
      kind: "edit",
      phase: "completed",
      action: "已完成修改文件",
      object: "run-block.tsx",
    });
  });

  it("never flashes back to an older concurrent activity", () => {
    const older = projectStructuredRunActivity({
      type: "item.started",
      item: { type: "tool_call", name: "较早工具" },
    }, 1, "2026-07-26T10:00:00.000Z")!;
    const newer = projectStructuredRunActivity({
      type: "item.completed",
      item: { type: "command_execution", command: "pnpm test", status: "completed" },
    }, 2, "2026-07-26T10:00:01.000Z")!;

    const current = chooseLatestRunActivity(chooseLatestRunActivity(null, older), newer);
    expect(chooseLatestRunActivity(current, older)).toBe(current);
    expect(current.action).toBe("已完成运行命令");
  });

  it("uses visible Agent progress only as a lower-priority observable fact", () => {
    const progress = projectAgentProgressActivity(
      "## 核对现状\n\n正在检查。",
      8,
      "2026-07-26T10:00:02.000Z",
    );
    const tool = projectStructuredRunActivity({
      type: "tool_call",
      name: "代码搜索",
    }, 8, "2026-07-26T10:00:02.000Z")!;

    expect(chooseLatestRunActivity(progress, tool)).toBe(tool);
  });
});
