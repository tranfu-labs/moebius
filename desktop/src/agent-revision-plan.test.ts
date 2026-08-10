import { describe, expect, it } from "vitest";

import {
  computeAgentMarkdownBlocks,
  planAgentRevisionOwnership,
  type AgentMarkdownBlockOwnership,
} from "./agent-revision-plan.js";

const headless = "处理一般对话与任务，不附加专业职责、固定流程或团队交棒。";

describe("computeAgentMarkdownBlocks", () => {
  it("splits on blank lines without assuming any heading structure", () => {
    const blocks = computeAgentMarkdownBlocks("# 角色\n\n负责实现。\n\n## 职责\n- 写代码\n");
    expect(blocks).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 11 },
      { start: 13, end: 25 },
    ]);
  });

  it("treats a document with no blank line as a single block (general-assistant scenario)", () => {
    const blocks = computeAgentMarkdownBlocks(headless);
    expect(blocks).toEqual([{ start: 0, end: headless.length }]);
  });

  it("handles blank lines with surrounding whitespace", () => {
    const blocks = computeAgentMarkdownBlocks("a\n  \n\nb");
    expect(blocks).toEqual([
      { start: 0, end: 1 },
      { start: 6, end: 7 },
    ]);
  });
});

function ownershipOf(
  content: string,
  authorKind: "user" | "official" | "agent" = "user",
  authorLabel = "你",
  timeLabel = "2026-08-01T00:00:00.000Z",
): AgentMarkdownBlockOwnership[] {
  return planAgentRevisionOwnership({
    previous: null,
    nextContent: content,
    authorKind,
    authorLabel,
    timeLabel,
  }).blocks;
}

describe("planAgentRevisionOwnership", () => {
  it("assigns every block to the first revision", () => {
    const plan = planAgentRevisionOwnership({
      previous: null,
      nextContent: "# 角色\n\n负责实现。\n",
      authorKind: "user",
      authorLabel: "你",
      timeLabel: "2026-08-01T00:00:00.000Z",
    });
    expect(plan.blocks).toEqual([
      {
        blockIndex: 0,
        authorKind: "user",
        authorLabel: "你",
        timeLabel: "2026-08-01T00:00:00.000Z",
        previousText: null,
      },
      {
        blockIndex: 1,
        authorKind: "user",
        authorLabel: "你",
        timeLabel: "2026-08-01T00:00:00.000Z",
        previousText: null,
      },
    ]);
  });

  it("carries unchanged blocks forward and marks only the edited block", () => {
    const first = "# 角色\n\n负责实现。\n\n## 职责\n- 写代码\n";
    const second = "# 角色\n\n负责实现。\n\n## 职责\n- 写代码并验证\n";
    const firstOwnership = ownershipOf(first);
    const plan = planAgentRevisionOwnership({
      previous: { content: first, ownership: firstOwnership },
      nextContent: second,
      authorKind: "user",
      authorLabel: "你",
      timeLabel: "2026-08-02T00:00:00.000Z",
    });
    expect(plan.blocks).toHaveLength(3);
    expect(plan.blocks[0]).toMatchObject({
      blockIndex: 0,
      authorKind: "user",
      timeLabel: "2026-08-01T00:00:00.000Z",
      previousText: null,
    });
    expect(plan.blocks[2]).toMatchObject({
      blockIndex: 2,
      authorKind: "user",
      timeLabel: "2026-08-02T00:00:00.000Z",
      previousText: "## 职责\n- 写代码\n",
    });
  });

  it("handles an inserted block: no previous text, newest author", () => {
    const first = "# 角色\n\n负责实现。\n";
    const second = "# 角色\n\n负责实现。\n\n## 克制\n- 不顺手重构\n";
    const plan = planAgentRevisionOwnership({
      previous: { content: first, ownership: ownershipOf(first) },
      nextContent: second,
      authorKind: "official",
      authorLabel: "官方 v1.3",
      timeLabel: "2026-08-03T00:00:00.000Z",
    });
    expect(plan.blocks).toHaveLength(3);
    expect(plan.blocks[2]).toMatchObject({
      blockIndex: 2,
      authorKind: "official",
      authorLabel: "官方 v1.3",
      timeLabel: "2026-08-03T00:00:00.000Z",
      previousText: null,
    });
  });

  it("handles a deleted block: remaining blocks re-index and carry ownership by position", () => {
    const first = "# 角色\n\n负责实现。\n\n## 克制\n- 不顺手重构\n";
    const second = "# 角色\n\n负责实现。\n";
    const plan = planAgentRevisionOwnership({
      previous: { content: first, ownership: ownershipOf(first) },
      nextContent: second,
      authorKind: "user",
      authorLabel: "你",
      timeLabel: "2026-08-04T00:00:00.000Z",
    });
    expect(plan.blocks).toHaveLength(2);
    expect(plan.blocks[0]).toMatchObject({ blockIndex: 0, authorKind: "user" });
    expect(plan.blocks[1]).toMatchObject({ blockIndex: 1, authorKind: "user" });
  });

  it("re-attributes a block edited twice to the latest revision", () => {
    const first = "# 角色\n\n负责实现。\n";
    const second = "# 角色\n\n负责实现并验证。\n";
    const third = "# 角色\n\n负责实现、验证并交付。\n";
    const firstOwnership = ownershipOf(first);
    const secondPlan = planAgentRevisionOwnership({
      previous: { content: first, ownership: firstOwnership },
      nextContent: second,
      authorKind: "user",
      authorLabel: "你",
      timeLabel: "2026-08-02T00:00:00.000Z",
    });
    const thirdPlan = planAgentRevisionOwnership({
      previous: { content: second, ownership: secondPlan.blocks },
      nextContent: third,
      authorKind: "official",
      authorLabel: "官方 v1.3",
      timeLabel: "2026-08-03T00:00:00.000Z",
    });
    expect(thirdPlan.blocks[1]).toMatchObject({
      blockIndex: 1,
      authorKind: "official",
      authorLabel: "官方 v1.3",
      timeLabel: "2026-08-03T00:00:00.000Z",
      previousText: "负责实现并验证。\n",
    });
  });

  it("carries a previous official author forward for unchanged blocks across a user edit", () => {
    const first = "# 角色\n\n官方段落。\n\n用户段落。\n";
    const firstOwnership = ownershipOf(first, "official", "官方 v1.2", "2026-07-28T00:00:00.000Z");
    const second = "# 角色\n\n官方段落。\n\n用户段落改了。\n";
    const plan = planAgentRevisionOwnership({
      previous: { content: first, ownership: firstOwnership },
      nextContent: second,
      authorKind: "user",
      authorLabel: "你",
      timeLabel: "2026-08-01T00:00:00.000Z",
    });
    expect(plan.blocks[1]).toMatchObject({
      blockIndex: 1,
      authorKind: "official",
      authorLabel: "官方 v1.2",
      timeLabel: "2026-07-28T00:00:00.000Z",
    });
    expect(plan.blocks[2]).toMatchObject({
      blockIndex: 2,
      authorKind: "user",
      authorLabel: "你",
      timeLabel: "2026-08-01T00:00:00.000Z",
      previousText: "用户段落。\n",
    });
  });
});
