import { describe, expect, it } from "vitest";

import {
  chooseLatestRunActivity,
  projectAgentProgressActivity,
  projectStructuredRunActivity,
  foldRunActivityStep,
  RUN_ACTIVITY_STEP_LIMIT,
  STEP_OUTPUT_LINE_LIMIT,
  type LocalRunActivity,
} from "../src/local-console/run-activity.js";

describe("local run activity projection", () => {
  it("projects a command without description as the wrapper-stripped command and a safe line object", () => {
    const activity = projectStructuredRunActivity({
      type: "item.started",
      item: {
        type: "command_execution",
        command: "zsh -lc pnpm test --filter /private/work/private runId=run-secret",
        output: "secret output",
      },
    }, 3, "2026-07-26T10:00:00.000Z");

    expect(activity).toMatchObject({
      cursor: 3,
      kind: "command",
      phase: "running",
      action: "正在运行命令",
      object: "pnpm test --filter /private/work/private",
      lineObject: "pnpm test",
    });
    // 步骤对象与活动行对象都不得带 run id 或路径末段之外的机器细节；展开用的
    // 输入保留命令原文（含其中的 run id，那是命令本身的一部分）。
    expect(JSON.stringify([activity?.object, activity?.lineObject])).not.toMatch(/run-secret/u);
    expect(JSON.stringify(activity)).not.toMatch(/token|password|bearer|api[_-]?key/iu);
  });

  it("prefers the provider's purpose description as the command object", () => {
    const activity = projectStructuredRunActivity({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "toolu_01",
          name: "Bash",
          input: { command: "pnpm test --filter src/foo", description: "List seed teams and git status" },
        },
      },
    }, 5, "2026-08-09T05:32:29.452Z");

    expect(activity).toMatchObject({
      kind: "command",
      phase: "running",
      object: "List seed teams and git status",
      lineObject: "List seed teams and git status",
      callId: "toolu_01",
      input: "pnpm test --filter src/foo",
    });
  });

  it("redacts credential assignments from captured input and output", () => {
    const activity = projectStructuredRunActivity({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "curl -H 'Authorization: Bearer sk-live-1234' https://example.com",
        output: "token=sk-live-5678\nok",
        status: "completed",
      },
    }, 6, "2026-08-09T05:32:30.000Z");

    expect(activity).toMatchObject({ kind: "command", phase: "completed" });
    expect(JSON.stringify(activity)).not.toMatch(/sk-live-1234|sk-live-5678/u);
    expect(activity?.output).toContain("***");
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

  it("classifies Claude Read tool_use by tool name and takes the file basename", () => {
    const activity = projectStructuredRunActivity({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_02",
          name: "Read",
          input: { file_path: "/private/work/src/operator-console.tsx" },
        },
      },
    }, 7, "2026-08-09T05:32:31.000Z");

    expect(activity).toMatchObject({
      kind: "read",
      object: "operator-console.tsx",
      callId: "toolu_02",
      input: "/private/work/src/operator-console.tsx",
    });
  });

  it("takes the skill name instead of the tool name for skill calls", () => {
    const activity = projectStructuredRunActivity({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_03",
          name: "Skill",
          input: { skill: "generate-avatar-set" },
        },
      },
    }, 8, "2026-08-09T05:32:32.000Z");

    expect(activity).toMatchObject({ kind: "tool", object: "generate-avatar-set" });
    expect(activity?.object).not.toBe("Skill");
  });

  it("strips the mcp server prefix from tool names", () => {
    const activity = projectStructuredRunActivity({
      type: "item.started",
      item: { type: "custom_tool_call", name: "mcp__filesystem__read_file", input: { path: "/tmp/a.txt" } },
    }, 9, "2026-08-09T05:32:33.000Z");

    expect(activity).toMatchObject({ kind: "tool", object: "read_file" });
  });

  it("keeps a search URL intact instead of compressing it into its last segment", () => {
    const activity = projectStructuredRunActivity({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_04",
          name: "WebSearch",
          input: { query: "https://example.com/docs/guides?q=process+steps" },
        },
      },
    }, 10, "2026-08-09T05:32:34.000Z");

    expect(activity).toMatchObject({
      kind: "search",
      object: "“https://example.com/docs/guides?q=process+steps”",
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

describe("thinking projection", () => {
  it("skips an empty thinking block instead of producing a bare row", () => {
    const activity = projectStructuredRunActivity({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "", signature: "" },
      },
    }, 3, "2026-08-09T05:32:26.733Z");

    expect(activity).toBeNull();
  });

  it("projects the first sentence of a thinking block as the object", () => {
    const activity = projectStructuredRunActivity({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "thinking",
          thinking: "先核对仓库现状。然后跑测试。",
          signature: "",
        },
      },
    }, 3, "2026-08-09T05:32:26.733Z");

    expect(activity).toMatchObject({
      kind: "thinking",
      action: "正在思考",
      object: "先核对仓库现状。",
      input: "先核对仓库现状。然后跑测试。",
    });
  });

  it("projects the first sentence of a Claude thinking delta", () => {
    const activity = projectStructuredRunActivity({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "决定先读设计文档。再决定方案。" },
      },
    }, 4, "2026-08-09T05:32:27.000Z");

    expect(activity).toMatchObject({ kind: "thinking", object: "决定先读设计文档。" });
  });

  it("projects a Codex reasoning summary as a thinking step", () => {
    const activity = projectStructuredRunActivity({
      type: "item.completed",
      item: {
        type: "reasoning",
        summary: [{ type: "summary_text", text: "**Planning complete** weighing decision tree" }],
      },
    }, 5, "2026-08-09T05:32:28.000Z");

    expect(activity).toMatchObject({ kind: "thinking", object: "**Planning complete** weighing decision tree" });
  });
});

describe("tool return projection", () => {
  it("projects a Claude tool_result as a completed return with output and call id", () => {
    const activity = projectStructuredRunActivity({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_result",
          tool_use_id: "toolu_01",
          content: [{ type: "text", text: "3 files changed" }],
          is_error: false,
        },
      },
    }, 12, "2026-08-09T05:32:40.000Z");

    expect(activity).toMatchObject({
      kind: "tool",
      phase: "completed",
      callId: "toolu_01",
      output: "3 files changed",
      outputRemainingLines: 0,
    });
  });

  it("marks a failed return with a readable error summary and no exit-code-only line", () => {
    const activity = projectStructuredRunActivity({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_result",
          tool_use_id: "toolu_01",
          content: [{ type: "text", text: "exit code 1\nfile not found: src/run-block.tsx" }],
          is_error: true,
        },
      },
    }, 13, "2026-08-09T05:32:41.000Z");

    expect(activity).toMatchObject({
      kind: "tool",
      phase: "completed",
      callId: "toolu_01",
      error: "file not found: src/run-block.tsx",
    });
  });

  it("falls back to the exit code when a failed return has no readable message", () => {
    const activity = projectStructuredRunActivity({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "pnpm test",
        exit_code: 2,
        output: "exit code 2",
        status: "failed",
      },
    }, 14, "2026-08-09T05:32:42.000Z");

    expect(activity).toMatchObject({ kind: "command", phase: "completed", error: "exit code 2" });
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

    expect(activity).toMatchObject({ kind: "command", phase: "running" });
    expect(activity?.object).toBeNull();
    expect(activity?.lineObject).toBeNull();
  });

  it("reads the last activity block of an assistant message", () => {
    const activity = projectStructuredRunActivity({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "先看仓库状态" },
          { type: "tool_use", name: "Bash", input: { command: "git status", description: "查看仓库状态" } },
        ],
      },
    }, 9, "2026-08-09T05:32:30.000Z");

    expect(activity).toMatchObject({ kind: "command", object: "查看仓库状态" });
  });

  it("reads a Kimi tool_call_update as a completed return", () => {
    const activity = projectStructuredRunActivity({
      sessionId: "s1",
      update: { sessionUpdate: "tool_call_update", toolCallId: "curl-1", status: "failed" },
    }, 15, "2026-08-09T05:32:43.000Z");

    expect(activity).toMatchObject({ kind: "tool", phase: "completed", callId: "curl-1" });
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

  it("merges a tool return into its call step by call identity and carries output", () => {
    let steps: readonly LocalRunActivity[] = [];
    steps = foldRunActivityStep(steps, {
      ...at("tool", "running", "Bash", 1),
      callId: "toolu_01",
      input: "pnpm test",
    });
    steps = foldRunActivityStep(steps, {
      ...at("tool", "running", "Bash", 2),
      callId: "toolu_01",
      input: "pnpm test",
    });
    steps = foldRunActivityStep(steps, {
      ...at("tool", "completed", null, 3),
      callId: "toolu_01",
      output: "3 files changed",
      outputRemainingLines: 0,
    });

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      callId: "toolu_01",
      phase: "completed",
      object: "Bash",
      output: "3 files changed",
    });
  });

  it("never surfaces a return whose start was not recorded", () => {
    const steps = foldRunActivityStep([], {
      ...at("tool", "completed", null, 1),
      callId: "toolu_missing",
      output: "orphan output",
    });

    expect(steps).toHaveLength(0);
  });

  it("refreshes the ongoing thinking row instead of stacking deltas", () => {
    let steps: readonly LocalRunActivity[] = [];
    steps = foldRunActivityStep(steps, { ...at("thinking", "running", "第一句。", 1), input: "第一句。第二句。" });
    steps = foldRunActivityStep(steps, { ...at("thinking", "running", "第二句。", 2), input: "第一句。第二句。第三句。" });

    expect(steps).toHaveLength(1);
    expect(steps[0]?.object).toBe("第二句。");
  });

  it("bounds the trail", () => {
    let steps: readonly LocalRunActivity[] = [];
    for (let index = 0; index < RUN_ACTIVITY_STEP_LIMIT + 5; index += 1) {
      steps = foldRunActivityStep(steps, at("tool", "running", `tool-${String(index)}`, index));
    }

    expect(steps).toHaveLength(RUN_ACTIVITY_STEP_LIMIT);
    expect(steps.at(-1)?.object).toBe(`tool-${String(RUN_ACTIVITY_STEP_LIMIT + 4)}`);
  });
});

describe("bounded step output", () => {
  it("keeps error lines first and then the leading lines, reporting the omitted count", () => {
    const lines = Array.from({ length: 15 }, (_, index) => `line ${String(index)}`);
    lines[9] = "error: cannot find module './missing'";
    const value = projectStructuredRunActivity({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_result",
          tool_use_id: "toolu_09",
          content: [{ type: "text", text: lines.join("\n") }],
        },
      },
    }, 20, "2026-08-09T05:32:50.000Z");

    expect(value?.output).toContain("error: cannot find module './missing'");
    expect(value?.output).toContain("line 0");
    expect(value?.outputRemainingLines).toBe(3);
  });

  it("keeps a short output whole", () => {
    const value = projectStructuredRunActivity({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_result",
          tool_use_id: "toolu_10",
          content: [{ type: "text", text: "ok\n" }],
        },
      },
    }, 21, "2026-08-09T05:32:51.000Z");

    expect(value?.output).toBe("ok");
    expect(value?.outputRemainingLines).toBe(0);
  });

  it("keeps a long output within the line limit", () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${String(index)}`);
    lines[7] = "error: cannot find module './missing'";
    const value = projectStructuredRunActivity({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_result",
          tool_use_id: "toolu_11",
          content: [{ type: "text", text: lines.join("\n") }],
        },
      },
    }, 22, "2026-08-09T05:32:52.000Z");

    expect(value?.outputRemainingLines).toBe(8);
    expect(value?.output?.split(/\r?\n/u)).toHaveLength(STEP_OUTPUT_LINE_LIMIT);
    // 错误行优先保留，随后按原顺序补足前导行。
    expect(value?.output).toContain("error: cannot find module './missing'");
    expect(value?.output).toContain("line 0");
  });

  it("exposes the line limit constant for the boundary contract", () => {
    expect(STEP_OUTPUT_LINE_LIMIT).toBe(12);
  });
});
