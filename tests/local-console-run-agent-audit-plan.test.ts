import { describe, expect, it } from "vitest";

import { projectRunAgentInfo, readRunAgentMarkdown } from "../src/local-console/run-agent-audit-plan.js";
import { createRunExecutionContext } from "../src/local-console/execution-context.js";

describe("run Agent audit projection", () => {
  it("uses historical snapshot identity and explicit process-start proof", () => {
    const context = createRunExecutionContext({
      sessionId: "session-a",
      runId: "run-a",
      sourceMessageId: 1,
      role: "lead",
      profile: { cli: "claude", model: "sonnet", effort: "high" },
      workspace: {
        cwd: "/tmp/work",
        mode: "direct",
        worktreePath: null,
        worktreeUnavailableReason: null,
        branchName: null,
        baseRef: null,
        originalRepoRoot: null,
      },
      team: [{ name: "lead", agentMarkdown: "historical", executionProfile: null }],
      teamSnapshot: {
        team: { ownership: "system", id: "team-a", name: "Old name", description: "Purpose", primaryAgentSlug: "lead", officialSourceName: "Moebius" },
        loadedAt: "2026-08-04T00:00:00.000Z",
        members: [{ name: "lead", displayName: "Lead", description: "Ships", agentMarkdown: "historical", executionProfile: null }],
      },
      recordedAt: "2026-08-04T00:01:00.000Z",
    });

    expect(projectRunAgentInfo({ context, processStarted: true, preStartTerminal: false })).toMatchObject({
      evidence: "executed",
      agent: { displayName: "Lead" },
      team: { name: "Old name", ownership: "system" },
      loadedAt: "2026-08-04T00:00:00.000Z",
    });
    expect(readRunAgentMarkdown(context)).toBe("historical");
  });

  it("does not claim execution for a pre-start terminal", () => {
    const context = createRunExecutionContext({
      sessionId: "session-a",
      runId: "run-b",
      sourceMessageId: 2,
      role: "lead",
      profile: null,
      workspace: { cwd: "/tmp/work", mode: "direct", worktreePath: null, worktreeUnavailableReason: null, branchName: null, baseRef: null, originalRepoRoot: null },
      team: [{ name: "lead", agentMarkdown: "legacy", executionProfile: null }],
      recordedAt: "2026-08-04T00:01:00.000Z",
    });
    expect(projectRunAgentInfo({ context, processStarted: true, preStartTerminal: true }).evidence)
      .toBe("planned-not-started");
  });
});
