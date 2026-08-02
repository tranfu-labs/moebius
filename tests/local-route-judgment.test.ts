import { describe, expect, it } from "vitest";

import {
  parseLocalRouteJudgment,
  validateLocalRouteAppendBody,
} from "../src/local-console/local-route-judgment.js";

describe("local route judgment", () => {
  it("parses no-action and fenced append results", () => {
    expect(parseLocalRouteJudgment('{"action":"no_action"}')).toEqual({ kind: "no_action" });
    expect(parseLocalRouteJudgment('```json\n{"action":"append","body":"@dev 请处理。"}\n```'))
      .toEqual({ kind: "append", body: "@dev 请处理。" });
  });

  it("rejects invalid and unknown result shapes", () => {
    expect(parseLocalRouteJudgment("not-json")).toMatchObject({ kind: "invalid_json" });
    expect(parseLocalRouteJudgment("[]")).toEqual({ kind: "invalid_json", detail: "output is not a JSON object" });
    expect(parseLocalRouteJudgment('{"action":"replace"}')).toEqual({ kind: "unknown_action", detail: "replace" });
  });

  it("accepts exactly one available mention and rejects unsafe targets", () => {
    expect(validateLocalRouteAppendBody("@dev 请处理。", ["dev", "qa"]))
      .toEqual({ ok: true, targetRole: "dev" });
    expect(validateLocalRouteAppendBody("没有交棒", ["dev"]))
      .toEqual({ ok: false, reason: "missing-mention" });
    expect(validateLocalRouteAppendBody("@dev 和 @qa", ["dev", "qa"]))
      .toMatchObject({ ok: false, reason: "multiple-mentions" });
    expect(validateLocalRouteAppendBody("@ghost 请处理。", ["dev"]))
      .toEqual({ ok: false, reason: "unknown-mention", detail: "ghost" });
  });
});
