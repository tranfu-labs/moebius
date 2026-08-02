import { describe, expect, it } from "vitest";

import {
  selectClaudeAiTeamBuilderSession,
  selectCodexAiTeamBuilderFailedSession,
  selectCodexAiTeamBuilderFailureResponseSession,
  selectCodexAiTeamBuilderSession,
  selectKimiAiTeamBuilderFailedSession,
  selectKimiAiTeamBuilderSession,
} from "../src/ai-team-builder/driver-session-plan.js";

describe("AI team builder driver session plans", () => {
  it("preserves each provider's observed-session precedence", () => {
    const input = {
      threadId: "wire-session",
      observedExternalSessionId: "callback-session",
      requestedExternalSessionId: "requested-session",
    };

    expect(selectClaudeAiTeamBuilderSession(input)).toBe("wire-session");
    expect(selectCodexAiTeamBuilderSession(input)).toBe("wire-session");
    expect(selectKimiAiTeamBuilderSession(input)).toBe("wire-session");
    expect(selectClaudeAiTeamBuilderSession({ ...input, threadId: null })).toBe("callback-session");
    expect(selectCodexAiTeamBuilderSession({ ...input, threadId: undefined })).toBe("callback-session");
    expect(selectKimiAiTeamBuilderSession({ ...input, threadId: null })).toBe("callback-session");
  });

  it("keeps Codex and Kimi failure ownership provider-specific", () => {
    expect(selectCodexAiTeamBuilderFailedSession({
      observedExternalSessionId: null,
      threadId: "failed-wire-session",
    })).toBe("failed-wire-session");
    expect(selectCodexAiTeamBuilderFailureResponseSession({
      requestedExternalSessionId: "requested-session",
      failedObservedExternalSessionId: "replacement-session",
    })).toBe("requested-session");
    expect(selectKimiAiTeamBuilderFailedSession({
      observedExternalSessionId: null,
      requestedExternalSessionId: "requested-session",
    })).toBe("requested-session");
  });

  it("returns null only when no provider-specific candidate exists", () => {
    const successInput = {
      threadId: null,
      observedExternalSessionId: null,
      requestedExternalSessionId: null,
    };

    expect(selectClaudeAiTeamBuilderSession(successInput)).toBeNull();
    expect(selectCodexAiTeamBuilderSession(successInput)).toBeNull();
    expect(selectKimiAiTeamBuilderSession(successInput)).toBeNull();
    expect(selectCodexAiTeamBuilderFailedSession({
      observedExternalSessionId: null,
      threadId: undefined,
    })).toBeNull();
  });
});
