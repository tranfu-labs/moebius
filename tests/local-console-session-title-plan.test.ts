import { describe, expect, it } from "vitest";

import {
  SESSION_TITLE_GENERATION_PROMPT,
  SESSION_TITLE_MAX_LENGTH,
  buildTitleGenerationPrompt,
  decideTitleGeneration,
  planTitleGenerationEnablement,
  projectTitleOneShotResult,
  sanitizeGeneratedTitle,
} from "../src/local-console/session-title-plan.js";

describe("session title generation decision", () => {
  it("generates only for the first message with text", () => {
    expect(decideTitleGeneration({ wasFirstMessage: true, firstMessageHasText: true }))
      .toEqual({ kind: "generate" });
    expect(decideTitleGeneration({ wasFirstMessage: false, firstMessageHasText: true }))
      .toEqual({ kind: "skip" });
    expect(decideTitleGeneration({ wasFirstMessage: true, firstMessageHasText: false }))
      .toEqual({ kind: "skip" });
  });

  it("projects the execution driver result onto the one-shot port result", () => {
    expect(projectTitleOneShotResult({ ok: true, finalText: "标题" }))
      .toEqual({ ok: true, text: "标题" });
    expect(projectTitleOneShotResult({ ok: false, reason: "boom" }))
      .toEqual({ ok: false, reason: "boom" });
  });

  it("plans the title generation enablement switch", () => {
    expect(planTitleGenerationEnablement(true)).toEqual({ kind: "enabled" });
    expect(planTitleGenerationEnablement(false)).toEqual({ kind: "disabled" });
  });
});

describe("session title generation prompt", () => {
  it("embeds the user-confirmed v2 prompt and the first message", () => {
    const prompt = buildTitleGenerationPrompt("推特效果平平，想改进推广");
    expect(prompt).toContain("意图加对象");
    expect(prompt).toContain("改进推特推广");
    expect(prompt).toContain("第一条消息：\n推特效果平平，想改进推广");
  });

  it("keeps the confirmed prompt wording frozen", () => {
    expect(SESSION_TITLE_GENERATION_PROMPT).toContain("不超过 20 字");
    expect(SESSION_TITLE_GENERATION_PROMPT).toContain("只输出标题本身");
  });
});

describe("session title sanitization", () => {
  it("keeps a plain title", () => {
    expect(sanitizeGeneratedTitle("改进推特推广")).toBe("改进推特推广");
  });

  it("strips surrounding quotes and collapses whitespace", () => {
    expect(sanitizeGeneratedTitle('"改进推特推广"')).toBe("改进推特推广");
    expect(sanitizeGeneratedTitle("「改进推特推广」")).toBe("改进推特推广");
    expect(sanitizeGeneratedTitle("改进\n  推特推广")).toBe("改进 推特推广");
  });

  it("extracts a JSON-shaped title defensively", () => {
    expect(sanitizeGeneratedTitle('{"title": "改进推特推广"}')).toBe("改进推特推广");
    expect(sanitizeGeneratedTitle("```json\n{\"title\": \"改进推特推广\"}\n```")).toBe("改进推特推广");
  });

  it("truncates by code points to the configured ceiling", () => {
    const title = "推".repeat(SESSION_TITLE_MAX_LENGTH + 5);
    const sanitized = sanitizeGeneratedTitle(title);
    expect(sanitized).not.toBeNull();
    expect([...(sanitized ?? "")].length).toBe(SESSION_TITLE_MAX_LENGTH);
  });

  it("rejects empty, symbol-only and punctuation-only output", () => {
    expect(sanitizeGeneratedTitle("")).toBeNull();
    expect(sanitizeGeneratedTitle("   ")).toBeNull();
    expect(sanitizeGeneratedTitle("。。。")).toBeNull();
    expect(sanitizeGeneratedTitle("--")).toBeNull();
  });

  it("rejects JSON without a usable title field", () => {
    expect(sanitizeGeneratedTitle('{"title": 42}')).toBeNull();
    expect(sanitizeGeneratedTitle('{"other": "x"}')).toBeNull();
  });
});
