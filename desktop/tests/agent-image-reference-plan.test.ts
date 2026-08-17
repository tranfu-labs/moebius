import { describe, expect, it } from "vitest";
import {
  agentImageCacheKey,
  agentImageReferenceKey,
  planAgentImageReferenceCandidates,
} from "../src/console-page/agent-image-reference-plan.js";

describe("agent image reference plan", () => {
  it("collects ordered candidates from agent messages only", () => {
    expect(planAgentImageReferenceCandidates([
      { sessionId: "session-a", speaker: "user", body: "看 /docs/user.png" },
      { sessionId: "session-a", speaker: "agent", body: "生成结果见 /docs/result.png。" },
      { sessionId: "session-a", speaker: "system", body: "系统 /docs/system.png" },
    ])).toEqual([{ sessionId: "session-a", path: "/docs/result.png" }]);
  });

  it("deduplicates the same path across messages and sessions by cache key", () => {
    const candidates = planAgentImageReferenceCandidates([
      { sessionId: "session-a", speaker: "agent", body: "见 /docs/logo.svg。" },
      { sessionId: "session-a", speaker: "agent", body: "再次见 /docs/logo.svg。" },
      { sessionId: "session-b", speaker: "agent", body: "另一个会话 /docs/logo.svg。" },
    ]);
    expect(candidates).toEqual([{ sessionId: "session-a", path: "/docs/logo.svg" }]);
    expect(agentImageCacheKey("session-a", "/docs/logo.svg")).not.toBe(
      agentImageCacheKey("session-b", "/docs/logo.svg"),
    );
    expect(agentImageReferenceKey({ sessionId: "session-a", path: "/docs/logo.svg" }))
      .toBe(agentImageCacheKey("session-a", "/docs/logo.svg"));
  });
});
