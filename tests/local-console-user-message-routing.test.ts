import { describe, expect, it } from "vitest";
import { resolveLocalUserMessageDispatch } from "../src/local-console/user-message-routing.js";

const team = ["dev-manager", "dev", "qa"];

describe("resolveLocalUserMessageDispatch", () => {
  it.each([
    ["没有点名", "primary", "dev-manager", "no-valid-mention"],
    ["@unknown 无效", "primary", "dev-manager", "no-valid-mention"],
    ["@qa 请验证", "worker", "qa", "single-valid-mention"],
    ["@unknown @qa 请验证", "worker", "qa", "single-valid-mention"],
    ["@qa 再请 @qa 验证", "worker", "qa", "single-valid-mention"],
    ["@qa @dev 分别处理", "primary", "dev-manager", "multiple-valid-mentions"],
  ] as const)("routes %s", (body, lane, role, reason) => {
    expect(resolveLocalUserMessageDispatch({
      body,
      availableAgentNames: team,
      primaryAgent: "dev-manager",
    })).toEqual({ lane, role, reason });
  });

  it("ignores mentions in inline and fenced code", () => {
    expect(resolveLocalUserMessageDispatch({
      body: "`@qa` and\n```md\n@dev\n```",
      availableAgentNames: team,
      primaryAgent: "dev-manager",
    })).toEqual({
      lane: "primary",
      role: "dev-manager",
      reason: "no-valid-mention",
    });
  });
});
