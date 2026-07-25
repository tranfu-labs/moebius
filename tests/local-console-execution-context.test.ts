import { describe, expect, it } from "vitest";

import type { LocalCodexResumeIntentFact } from "../src/local-console/codex-resume.js";
import {
  createRunExecutionContext,
  legacyCodexContextFingerprint,
  planLocalExecutionRecovery,
  type LocalExecutionSessionLinkFact,
} from "../src/local-console/execution-context.js";

const intent: LocalCodexResumeIntentFact = {
  sessionId: "session-a",
  intentId: "intent-a",
  targetRunId: "run-old",
  sourceMessageId: 7,
  role: "dev",
  reason: "retry",
  createdAt: "2026-07-25T00:00:00.000Z",
};

function context(input: {
  runId: string;
  sourceMessageId?: number;
  cli: "codex" | "kimi" | "legacy";
  markdown: string;
}) {
  const profile = input.cli === "legacy"
    ? null
    : {
        cli: input.cli,
        model: input.cli === "kimi" ? "kimi-for-coding" : "gpt-5.6-sol",
        effort: "high",
      } as const;
  return createRunExecutionContext({
    sessionId: "session-a",
    runId: input.runId,
    sourceMessageId: input.sourceMessageId ?? 7,
    role: "dev",
    profile,
    workspace: {
      cwd: "/tmp/project",
      mode: "direct",
      worktreePath: null,
      worktreeUnavailableReason: null,
      branchName: null,
      baseRef: null,
      originalRepoRoot: null,
    },
    team: [{
      name: "dev",
      agentMarkdown: input.markdown,
      executionProfile: profile,
    }],
    recordedAt: "2026-07-25T00:00:01.000Z",
  });
}

function link(
  target: ReturnType<typeof context>,
  overrides: Partial<LocalExecutionSessionLinkFact> = {},
): LocalExecutionSessionLinkFact {
  return {
    sessionId: target.sessionId,
    runId: target.runId,
    sourceMessageId: target.sourceMessageId,
    role: target.role,
    engine: target.engine,
    externalSessionId: "external-a",
    profileFingerprint: target.profileFingerprint,
    contextFingerprint: target.contextFingerprint,
    startedAt: "2026-07-25T00:00:02.000Z",
    ...overrides,
  };
}

describe("local execution recovery planning", () => {
  it("resumes only the exact engine, profile and immutable run context", () => {
    const old = context({ runId: "run-old", cli: "kimi", markdown: "old team" });
    const current = context({ runId: "run-new", cli: "codex", markdown: "new team" });
    expect(planLocalExecutionRecovery({
      sourceMessageId: 7,
      role: "dev",
      currentContext: current,
      intents: [intent],
      consumedIntentIds: new Set(),
      executionLinks: [link(old)],
      legacyCodexLinks: [],
      contexts: [old],
    })).toMatchObject({
      kind: "resume",
      externalSessionId: "external-a",
      context: {
        engine: "kimi",
        profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
        team: [{ agentMarkdown: "old team" }],
      },
    });
  });

  it("uses the old Kimi context for full fallback and never adopts the current Codex team", () => {
    const old = context({ runId: "run-old", cli: "kimi", markdown: "old team" });
    const current = context({ runId: "run-new", cli: "codex", markdown: "new team" });
    const plan = planLocalExecutionRecovery({
      sourceMessageId: 7,
      role: "dev",
      currentContext: current,
      intents: [intent],
      consumedIntentIds: new Set(),
      executionLinks: [link(old, { profileFingerprint: "tampered" })],
      legacyCodexLinks: [],
      contexts: [old],
    });
    expect(plan).toMatchObject({
      kind: "full-fallback",
      reason: "profile-mismatch",
      context: {
        engine: "kimi",
        team: [{ agentMarkdown: "old team" }],
      },
    });
  });

  it("keeps a legacy Codex link on the immutable legacy identity", () => {
    const old = context({ runId: "run-old", cli: "legacy", markdown: "legacy team" });
    const current = context({ runId: "run-new", cli: "codex", markdown: "new team" });
    const plan = planLocalExecutionRecovery({
      sourceMessageId: 7,
      role: "dev",
      currentContext: current,
      intents: [intent],
      consumedIntentIds: new Set(),
      executionLinks: [],
      legacyCodexLinks: [{
        sessionId: "session-a",
        runId: "run-old",
        sourceMessageId: 7,
        role: "dev",
        threadId: "thread-old",
        startedAt: "2026-07-25T00:00:02.000Z",
        contextFingerprint: legacyCodexContextFingerprint(old),
      }],
      contexts: [old],
    });
    expect(plan).toMatchObject({
      kind: "resume",
      externalSessionId: "thread-old",
      context: { engine: "codex", profile: null },
    });
  });

  it.each([
    {
      name: "Kimi link with a current Codex team",
      executionLinks: [{
        ...link(context({ runId: "run-old", cli: "kimi", markdown: "old team" })),
      }],
      legacyCodexLinks: [],
    },
    {
      name: "missing session link",
      executionLinks: [],
      legacyCodexLinks: [],
    },
    {
      name: "legacy link after switching teams",
      executionLinks: [],
      legacyCodexLinks: [{
        sessionId: "session-a",
        runId: "run-old",
        sourceMessageId: 7,
        role: "dev",
        threadId: "thread-old",
        startedAt: "2026-07-25T00:00:02.000Z",
        contextFingerprint: legacyCodexContextFingerprint(
          context({ runId: "run-new", cli: "legacy", markdown: "old team" }),
        ),
      }],
    },
  ])("fails closed when immutable old context is missing: $name", ({ executionLinks, legacyCodexLinks }) => {
    const current = context({ runId: "run-new", cli: "codex", markdown: "new team" });
    expect(planLocalExecutionRecovery({
      sourceMessageId: 7,
      role: "dev",
      currentContext: current,
      intents: [intent],
      consumedIntentIds: new Set(),
      executionLinks,
      legacyCodexLinks,
      contexts: [],
    })).toEqual({
      kind: "unsafe",
      intent,
      reason: "run-context-missing",
    });
  });
});
