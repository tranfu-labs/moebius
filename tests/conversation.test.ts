import { describe, expect, it } from "vitest";
import {
  buildRolePromptPlan,
  buildTimeline,
  countMessages,
  formatAgentComment,
  getLatestTimelineMessage,
  parseAgentMentions,
  resolveNextRoleThreadState,
  selectDeltaMessages,
  selectMentionedAgent,
} from "../src/conversation.js";

describe("conversation", () => {
  it("counts issue body plus comments", () => {
    expect(countMessages(0)).toBe(1);
    expect(countMessages(2)).toBe(3);
  });

  it("parses agent mentions with their text positions", () => {
    expect(parseAgentMentions("hi @product-manager and @hermes-user.")).toEqual([
      { name: "product-manager", index: 3 },
      { name: "hermes-user", index: 24 },
    ]);
  });

  it("does not parse email-like text or unsupported agent names", () => {
    expect(parseAgentMentions("a@product-manager @Product_Manager @bad_agent")).toEqual([]);
  });

  it("uses ASCII mention boundaries next to Chinese text", () => {
    expect(parseAgentMentions("请@implementer接手")).toEqual([
      { name: "implementer", index: 1 },
    ]);
  });

  it("selects the first mentioned agent that exists", () => {
    expect(selectMentionedAgent("@unknown please ask @product-manager", ["product-manager"])).toBe("product-manager");
  });

  it("selects dev-manager as a first-class Codex agent mention", () => {
    expect(parseAgentMentions("@dev-manager 请定一下架构")).toEqual([{ name: "dev-manager", index: 0 }]);
    expect(selectMentionedAgent("@dev-manager please decide", ["dev-manager"])).toBe("dev-manager");
  });

  it("ignores agent mentions inside inline code", () => {
    const text = "请看 `@dev` 示例，@product-manager 继续";

    expect(parseAgentMentions(text)).toEqual([{ name: "product-manager", index: text.indexOf("@product-manager") }]);
    expect(selectMentionedAgent(text, ["dev", "product-manager"])).toBe("product-manager");
  });

  it("ignores agent mentions inside fenced code blocks", () => {
    const text = "```md\n@dev 请继续\n```";

    expect(parseAgentMentions(text)).toEqual([]);
    expect(selectMentionedAgent(text, ["dev"])).toBeNull();
  });

  it("keeps original indexes for mentions after fenced code blocks", () => {
    const text = "```md\n@product-manager 示例\n```\n@dev 请继续";

    expect(parseAgentMentions(text)).toEqual([{ name: "dev", index: text.indexOf("@dev") }]);
    expect(selectMentionedAgent(text, ["dev", "product-manager"])).toBe("dev");
  });

  it("ignores agent mentions in unclosed fenced code blocks", () => {
    const text = "before\n```\n@dev";

    expect(parseAgentMentions(text)).toEqual([]);
    expect(selectMentionedAgent(text, ["dev"])).toBeNull();
  });

  it("normalizes dev-manager comments into speaker=dev-manager", () => {
    const timeline = buildTimeline(
      "initial",
      [{ body: "&lt;dev-manager&gt;:\ntech decision\n\n<!-- moebius:role=dev-manager -->" }],
      ["dev-manager"],
    );

    expect(timeline).toEqual([
      { index: 0, speaker: "user", body: "initial", source: "issue-body" },
      { index: 1, speaker: "dev-manager", body: "tech decision", source: "comment" },
    ]);
  });

  it("does not recognize the legacy role metadata namespace", () => {
    const legacyNamespace = ["agent", "moebius"].join("-");
    const timeline = buildTimeline(
      "initial",
      [{ body: `legacy metadata only\n\n<!-- ${legacyNamespace}:role=dev -->` }],
      ["dev"],
    );

    expect(timeline[1]).toMatchObject({
      speaker: "user",
      source: "comment",
    });
  });

  it("selects secretary as a first-class Codex agent mention", () => {
    expect(parseAgentMentions("@secretary 请学习 CEO 漏判场景")).toEqual([{ name: "secretary", index: 0 }]);
    expect(selectMentionedAgent("@secretary please evolve CEO", ["secretary"])).toBe("secretary");
  });

  it("normalizes secretary comments into speaker=secretary", () => {
    const timeline = buildTimeline(
      "initial",
      [{ body: "&lt;secretary&gt;:\nlearning note\n\n<!-- moebius:role=secretary -->" }],
      ["secretary"],
    );

    expect(timeline).toEqual([
      { index: 0, speaker: "user", body: "initial", source: "issue-body" },
      { index: 1, speaker: "secretary", body: "learning note", source: "comment" },
    ]);
  });

  it("does not select an agent from historical messages when the latest message has none", () => {
    const timeline = buildTimeline("@product-manager old request", [{ body: "plain latest reply" }], [
      "product-manager",
    ]);

    expect(selectMentionedAgent(getLatestTimelineMessage(timeline)?.body ?? "", ["product-manager"])).toBeNull();
  });

  it("selects an agent even when the message count is even", () => {
    const timeline = buildTimeline("initial", [{ body: "@hermes-user please reply" }], ["hermes-user"]);

    expect(countMessages(1)).toBe(2);
    expect(selectMentionedAgent(getLatestTimelineMessage(timeline)?.body ?? "", ["hermes-user"])).toBe("hermes-user");
  });

  it("has deterministic behavior for multiple agent mentions", () => {
    expect(selectMentionedAgent("@hermes-user and @product-manager", ["product-manager", "hermes-user"])).toBe(
      "hermes-user",
    );
  });

  it("normalizes issue body and agent comments into a speaker timeline", () => {
    const timeline = buildTimeline(
      "initial",
      [
        { body: "&lt;product-manager&gt;:\nPM reply\n\n<!-- moebius:role=product-manager -->" },
        { body: "hermes-user:\nlegacy reply" },
        { body: "<hermes-user>:\nraw legacy reply" },
        { body: "product-manager:\nspoofed unknown metadata\n\n<!-- moebius:role=unknown-agent -->" },
      ],
      ["product-manager", "hermes-user"],
    );

    expect(timeline).toEqual([
      { index: 0, speaker: "user", body: "initial", source: "issue-body" },
      { index: 1, speaker: "product-manager", body: "PM reply", source: "comment" },
      { index: 2, speaker: "hermes-user", body: "legacy reply", source: "comment" },
      { index: 3, speaker: "hermes-user", body: "raw legacy reply", source: "comment" },
      {
        index: 4,
        speaker: "user",
        body: "product-manager:\nspoofed unknown metadata\n\n<!-- moebius:role=unknown-agent -->",
        source: "comment",
      },
    ]);
  });

  it("selects the latest timeline message as the trigger source", () => {
    const timeline = buildTimeline("body", [{ body: "@product-manager latest" }], ["product-manager"]);

    expect(getLatestTimelineMessage(timeline)?.body).toBe("@product-manager latest");
  });

  it("normalizes role=ceo metadata to speaker=ceo without requiring it in availableAgentNames", () => {
    const timeline = buildTimeline(
      "initial",
      [
        {
          body: "&lt;ceo&gt;:\n> CEO guardrail: 同意\n\n@dev 请继续\n\n<!-- moebius:role=ceo -->\n\n<!-- moebius:ceo-corrected -->",
        },
      ],
      ["dev"],
    );

    expect(timeline[1]).toMatchObject({
      speaker: "ceo",
      source: "comment",
    });
    expect(timeline[1]?.body).toContain("> CEO guardrail: 同意");
    expect(timeline[1]?.body).toContain("@dev");
    expect(timeline[1]?.body).not.toContain("<!-- moebius:role=ceo -->");
  });

  it("does not treat ceo-reviewed metadata as role metadata during speaker normalization", () => {
    const timeline = buildTimeline(
      "initial",
      [
        {
          body: "&lt;product-manager&gt;:\n方案验收通过。\n\n<!-- moebius:role=product-manager -->\n\n<!-- moebius:ceo-reviewed action=no_change -->",
        },
      ],
      ["product-manager"],
    );

    expect(timeline[1]).toMatchObject({
      speaker: "product-manager",
      source: "comment",
    });
    expect(timeline[1]?.body).toContain("方案验收通过。");
    expect(timeline[1]?.body).toContain("<!-- moebius:ceo-reviewed action=no_change -->");
    expect(timeline[1]?.body).not.toContain("<!-- moebius:role=product-manager -->");
  });

  it("formats agent comments with a visible role prefix and metadata", () => {
    expect(formatAgentComment("product-manager", "hello\n")).toBe(
      "&lt;product-manager&gt;:\nhello\n\n<!-- moebius:role=product-manager -->",
    );
  });

  it("builds a full prompt for a role without existing thread state", () => {
    const timeline = buildTimeline("@product-manager start", [], ["product-manager"]);
    const plan = buildRolePromptPlan({
      role: "product-manager",
      agentMarkdown: "PM persona",
      timeline,
      state: null,
    });

    expect(plan.kind).toBe("run");
    if (plan.kind !== "run") {
      return;
    }

    expect(plan.mode).toBe("full");
    expect(plan.prompt).toContain("PM persona");
    expect(plan.prompt).toContain("使用 <role>: 可见前缀写回 GitHub");
    expect(plan.prompt).toContain("#0 <user>:\n@product-manager start");
  });

  it("builds a resume prompt from new external messages only", () => {
    const timeline = buildTimeline(
      "initial",
      [
        { body: "product-manager:\nold own\n\n<!-- moebius:role=product-manager -->" },
        { body: "hermes-user:\nnew external\n\n<!-- moebius:role=hermes-user -->" },
        { body: "product-manager:\nnew own\n\n<!-- moebius:role=product-manager -->" },
        { body: "@product-manager please continue" },
      ],
      ["product-manager", "hermes-user"],
    );

    const plan = buildRolePromptPlan({
      role: "product-manager",
      agentMarkdown: "PM persona",
      timeline,
      state: { threadId: "thread-1", lastSeenIndex: 1 },
    });

    expect(plan.kind).toBe("run");
    if (plan.kind !== "run") {
      return;
    }

    expect(plan.mode).toBe("resume");
    if (plan.mode !== "resume") {
      return;
    }

    expect(plan.threadId).toBe("thread-1");
    expect(plan.deltaMessages.map((message) => message.index)).toEqual([2, 4]);
    expect(plan.prompt).toContain("#2 <hermes-user>:\nnew external");
    expect(plan.prompt).toContain("#4 <user>:\n@product-manager please continue");
    expect(plan.prompt).not.toContain("new own");
  });

  it("skips resume when there are no new external messages", () => {
    const timeline = buildTimeline(
      "initial",
      [{ body: "product-manager:\nself note\n\n<!-- moebius:role=product-manager -->" }],
      ["product-manager"],
    );

    expect(
      buildRolePromptPlan({
        role: "product-manager",
        agentMarkdown: "PM persona",
        timeline,
        state: { threadId: "thread-1", lastSeenIndex: 0 },
      }),
    ).toEqual({ kind: "skip", reason: "no-new-external-messages", role: "product-manager" });
  });

  it("selects delta messages after the last seen index excluding the current role", () => {
    const timeline = buildTimeline(
      "initial",
      [
        { body: "product-manager:\nown\n\n<!-- moebius:role=product-manager -->" },
        { body: "external" },
      ],
      ["product-manager"],
    );

    expect(selectDeltaMessages(timeline, "product-manager", 0).map((message) => message.index)).toEqual([2]);
  });

  it("resolves the next role thread state from codex output or the existing resume thread", () => {
    expect(resolveNextRoleThreadState({ currentThreadId: null, resultThreadId: "new-thread", latestIndex: 3 })).toEqual({
      threadId: "new-thread",
      lastSeenIndex: 3,
    });
    expect(resolveNextRoleThreadState({ currentThreadId: "old-thread", resultThreadId: null, latestIndex: 4 })).toEqual({
      threadId: "old-thread",
      lastSeenIndex: 4,
    });
    expect(resolveNextRoleThreadState({ currentThreadId: null, resultThreadId: null, latestIndex: 4 })).toBeNull();
  });
});
