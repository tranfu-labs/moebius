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

  it("first revision against a baseline marks only actually changed blocks (product-review blocker 1)", () => {
    const baseline = "# 角色\n\n负责实现。\n\n## 职责\n- 写代码\n";
    const next = "# 角色\n\n负责实现并验证。\n\n## 职责\n- 写代码\n";
    const plan = planAgentRevisionOwnership({
      previous: { content: baseline, ownership: null },
      nextContent: next,
      authorKind: "user",
      authorLabel: "你",
      timeLabel: "2026-08-01T00:00:00.000Z",
    });
    // Block 0 and 2 are unchanged vs. the baseline: they stay ownerless (no
    // marker, no fake author). Block 1 changed: it takes this revision's
    // author and keeps the baseline text for inline expansion.
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0]).toMatchObject({
      blockIndex: 1,
      authorKind: "user",
      authorLabel: "你",
      timeLabel: "2026-08-01T00:00:00.000Z",
      previousText: "负责实现。",
    });
  });

  it("baseline-ownerless blocks stay ownerless on the next revision until they actually change", () => {
    const baseline = "# 角色\n\n负责实现。\n";
    const second = "# 角色\n\n负责实现并验证。\n";
    const secondPlan = planAgentRevisionOwnership({
      previous: { content: baseline, ownership: null },
      nextContent: second,
      authorKind: "user",
      authorLabel: "你",
      timeLabel: "2026-08-01T00:00:00.000Z",
    });
    // The next save touches a DIFFERENT block: the previously-changed block
    // carries forward, and the untouched baseline block must NOT suddenly
    // appear as changed just because it has no owner.
    const third = "# 角色\n\n负责实现并验证。\n\n## 克制\n- 不顺手重构\n";
    const thirdPlan = planAgentRevisionOwnership({
      previous: { content: second, ownership: secondPlan.blocks },
      nextContent: third,
      authorKind: "official",
      authorLabel: "官方 v1.3",
      timeLabel: "2026-08-02T00:00:00.000Z",
    });
    expect(thirdPlan.blocks).toHaveLength(2);
    expect(thirdPlan.blocks[0]).toMatchObject({
      blockIndex: 1,
      authorKind: "user",
      timeLabel: "2026-08-01T00:00:00.000Z",
    });
    expect(thirdPlan.blocks[1]).toMatchObject({
      blockIndex: 2,
      authorKind: "official",
      authorLabel: "官方 v1.3",
      timeLabel: "2026-08-02T00:00:00.000Z",
      previousText: null,
    });
  });

  it("an ownership-unknown starting revision behaves like a baseline", () => {
    const starting = "# 角色\n\n负责实现。\n";
    const next = "# 角色\n\n负责实现并验证。\n";
    const plan = planAgentRevisionOwnership({
      previous: { content: starting, ownership: [] },
      nextContent: next,
      authorKind: "user",
      authorLabel: "你",
      timeLabel: "2026-08-01T00:00:00.000Z",
    });
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0]).toMatchObject({ blockIndex: 1, authorKind: "user", previousText: "负责实现。\n" });
  });

  it("never marks a zero-length trailing block (editor serialization artifact)", () => {
    // The contentEditable serialization can end with a blank line; the
    // boundary regex turns it into an empty final block that must not inflate
    // the marker count (the mechanical summary must equal the visible bands).
    const first = "# 角色\n\n负责实现。\n";
    const second = "# 角色\n\n负责实现并验证。\n\n";
    const plan = planAgentRevisionOwnership({
      previous: { content: first, ownership: ownershipOf(first) },
      nextContent: second,
      authorKind: "user",
      authorLabel: "你",
      timeLabel: "2026-08-01T00:00:00.000Z",
    });
    expect(plan.blocks).toHaveLength(2);
    expect(plan.blocks[0]).toMatchObject({ blockIndex: 0, authorKind: "user" });
    expect(plan.blocks[1]).toMatchObject({ blockIndex: 1, authorKind: "user" });
  });

  it("skips empty blocks on the very first revision too", () => {
    const plan = planAgentRevisionOwnership({
      previous: null,
      nextContent: "# 角色\n\n负责实现。\n\n",
      authorKind: "user",
      authorLabel: "你",
      timeLabel: "2026-08-01T00:00:00.000Z",
    });
    expect(plan.blocks).toHaveLength(2);
    expect(plan.blocks.map((block) => block.blockIndex)).toEqual([0, 1]);
  });
});
