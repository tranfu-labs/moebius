import { describe, expect, it } from "vitest";

import {
  chooseLatestRunActivity,
  projectAgentProgressActivity,
  projectStructuredRunActivity,
  foldRunActivityStep,
  RUN_ACTIVITY_STEP_LIMIT,
  type LocalRunActivity,
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

describe("nested provider envelopes", () => {
  it("reads the tool name out of a Claude streaming content block", () => {
    // 取自真实 claude-stream.jsonl
    const activity = projectStructuredRunActivity({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu_01", name: "Bash", input: {} },
      },
    }, 7, "2026-08-09T05:32:29.452Z");

    expect(activity).toMatchObject({ kind: "tool", phase: "running", object: "Bash" });
  });

  it("surfaces a thinking block as its own step", () => {
    const activity = projectStructuredRunActivity({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "", signature: "" },
      },
    }, 3, "2026-08-09T05:32:26.733Z");

    expect(activity).toMatchObject({ kind: "thinking", action: "正在思考" });
  });

  it("reads the last activity block of an assistant message", () => {
    const activity = projectStructuredRunActivity({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "先看仓库状态" },
          { type: "tool_use", name: "Bash", input: { command: "git status" } },
        ],
      },
    }, 9, "2026-08-09T05:32:30.000Z");

    expect(activity).toMatchObject({ kind: "tool", object: "Bash" });
  });
});

describe("folding activities into a step trail", () => {
  const at = (kind: LocalRunActivity["kind"], phase: LocalRunActivity["phase"], object: string | null, cursor: number): LocalRunActivity =>
    ({ cursor, kind, phase, action: `${phase === "completed" ? "已完成" : "正在"}${kind}`, object, occurredAt: "2026-08-09T05:32:00.000Z" });

  it("drops streaming progress and collapses one tool call into one step", () => {
    let steps: readonly LocalRunActivity[] = [];
    // 真实流里同一次工具调用会连发很多条；过程条不该因此堆出重复行
    for (const activity of [
      at("progress", "running", "已", 1),
      at("tool", "running", "Bash", 2),
      at("tool", "running", "Bash", 3),
      at("progress", "running", "继续", 4),
    ]) {
      steps = foldRunActivityStep(steps, activity);
    }

    expect(steps.map((step) => [step.kind, step.object])).toEqual([["tool", "Bash"]]);
  });

  it("closes the running step instead of appending its completion", () => {
    const running = foldRunActivityStep([], at("command", "running", "zsh wc", 1));
    const settled = foldRunActivityStep(running, at("command", "completed", "zsh wc", 2));

    expect(settled).toHaveLength(1);
    expect(settled[0]?.phase).toBe("completed");
  });

  it("keeps distinct steps and bounds the trail", () => {
    let steps: readonly LocalRunActivity[] = [];
    for (let index = 0; index < RUN_ACTIVITY_STEP_LIMIT + 5; index += 1) {
      steps = foldRunActivityStep(steps, at("tool", "running", `tool-${String(index)}`, index));
    }

    expect(steps).toHaveLength(RUN_ACTIVITY_STEP_LIMIT);
    expect(steps.at(-1)?.object).toBe(`tool-${String(RUN_ACTIVITY_STEP_LIMIT + 4)}`);
  });
});
