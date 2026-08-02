import { describe, expect, it } from "vitest";
import { buildTimeline } from "../src/conversation.js";
import { resolveTrigger } from "../src/triggers/index.js";

const agents = ["dev", "product-manager", "secretary"];

describe("local mention triggers", () => {
  it("routes supported agents and ignores unavailable roles", () => {
    expect(resolveTrigger({
      timeline: buildTimeline("@dev please handle this", [], agents),
      availableAgentNames: agents,
    })).toEqual({ kind: "run-agent", role: "dev", reason: "mention" });
    expect(resolveTrigger({
      timeline: buildTimeline("@reflector please remind dev", [], agents),
      availableAgentNames: agents,
    })).toEqual({ kind: "skip", reason: "no-trigger" });
  });

  it("ignores mentions inside Markdown code", () => {
    for (const body of ["```md\n@dev please handle this\n```", "示例：`@dev please handle this`"]) {
      expect(resolveTrigger({
        timeline: buildTimeline(body, [], agents),
        availableAgentNames: agents,
      })).toEqual({ kind: "skip", reason: "no-trigger" });
    }
  });

  it("uses only the latest local message as the trigger source", () => {
    expect(resolveTrigger({
      timeline: buildTimeline("@dev old", [{ body: "plain latest" }], agents),
      availableAgentNames: agents,
    })).toEqual({ kind: "skip", reason: "no-trigger" });
    expect(resolveTrigger({
      timeline: buildTimeline("initial", [{ body: "@secretary continue" }], agents),
      availableAgentNames: agents,
    })).toEqual({ kind: "run-agent", role: "secretary", reason: "mention" });
  });
});
