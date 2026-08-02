import { describe, expect, it } from "vitest";

import {
  parseSuccessfulConversationRequest,
  selectConversationAgentTeam,
} from "../src/team-conversation-preference-plan.js";

describe("team conversation preference plan", () => {
  const team = {
    id: "development",
    ownership: "system" as const,
    definition: null,
    members: [],
    status: "usable" as const,
    canCreateConversation: true,
    capabilities: { canEditContent: true, canDeleteTeam: false },
    issues: [],
  };

  it("selects an available team only for a live session", () => {
    const request = parseSuccessfulConversationRequest({
      sessionId: "session-1",
      teamId: "development",
      ownership: "system",
    });
    expect(selectConversationAgentTeam({
      sessionExists: true,
      listed: { status: "ready", registrationIssues: [], teams: [team] },
      request,
    })).toBe(team);
    expect(() => selectConversationAgentTeam({
      sessionExists: false,
      listed: { status: "ready", registrationIssues: [], teams: [team] },
      request,
    })).toThrow("仍然存在");
  });

  it("rejects unavailable and malformed selections", () => {
    expect(() => parseSuccessfulConversationRequest({
      sessionId: "",
      teamId: "development",
      ownership: "system",
    })).toThrow("成功创建");
    expect(() => selectConversationAgentTeam({
      sessionExists: true,
      listed: { status: "configuration-error" },
      request: { sessionId: "session-1", teamId: "development", ownership: "system" },
    })).toThrow("不能用于新建对话");
  });
});
