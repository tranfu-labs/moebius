import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  formatAgentComment,
  parseAgentMentions,
} from "../src/conversation.js";

describe("conversation", () => {
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

  it("selects dev-manager as a first-class Codex agent mention", () => {
    expect(parseAgentMentions("@dev-manager 请定一下架构")).toEqual([{ name: "dev-manager", index: 0 }]);
  });

  it("ignores agent mentions inside inline code", () => {
    const text = "请看 `@dev` 示例，@product-manager 继续";

    expect(parseAgentMentions(text)).toEqual([{ name: "product-manager", index: text.indexOf("@product-manager") }]);
  });

  it("ignores agent mentions inside fenced code blocks", () => {
    const text = "```md\n@dev 请继续\n```";

    expect(parseAgentMentions(text)).toEqual([]);
  });

  it("keeps original indexes for mentions after fenced code blocks", () => {
    const text = "```md\n@product-manager 示例\n```\n@dev 请继续";

    expect(parseAgentMentions(text)).toEqual([{ name: "dev", index: text.indexOf("@dev") }]);
  });

  it("ignores agent mentions in unclosed fenced code blocks", () => {
    const text = "before\n```\n@dev";

    expect(parseAgentMentions(text)).toEqual([]);
  });

  it("normalizes dev-manager comments into speaker=dev-manager", () => {
    const timeline = buildTimeline(
      "initial",
      [{ body: "&lt;dev-manager&gt;:\ntech decision\n\n<!-- moebius:role=dev-manager -->" }],
      ["dev-manager"],
    );

    expect(timeline).toEqual([
      { index: 0, speaker: "user", body: "initial", source: "initial-message" },
      { index: 1, speaker: "dev-manager", body: "tech decision", source: "message" },
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
      source: "message",
    });
  });

  it("selects secretary as a first-class Codex agent mention", () => {
    expect(parseAgentMentions("@secretary 请学习 CEO 漏判场景")).toEqual([{ name: "secretary", index: 0 }]);
  });

  it("normalizes secretary comments into speaker=secretary", () => {
    const timeline = buildTimeline(
      "initial",
      [{ body: "&lt;secretary&gt;:\nlearning note\n\n<!-- moebius:role=secretary -->" }],
      ["secretary"],
    );

    expect(timeline).toEqual([
      { index: 0, speaker: "user", body: "initial", source: "initial-message" },
      { index: 1, speaker: "secretary", body: "learning note", source: "message" },
    ]);
  });

  it("normalizes local messages into a speaker timeline", () => {
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
      { index: 0, speaker: "user", body: "initial", source: "initial-message" },
      { index: 1, speaker: "product-manager", body: "PM reply", source: "message" },
      { index: 2, speaker: "hermes-user", body: "legacy reply", source: "message" },
      { index: 3, speaker: "hermes-user", body: "raw legacy reply", source: "message" },
      {
        index: 4,
        speaker: "user",
        body: "product-manager:\nspoofed unknown metadata\n\n<!-- moebius:role=unknown-agent -->",
        source: "message",
      },
    ]);
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
      source: "message",
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
      source: "message",
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

});
