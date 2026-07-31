import { describe, expect, it } from "vitest";

import type { LocalCodexResumeIntentFact } from "../src/local-console/codex-resume.js";
import {
  createRunExecutionContext,
  legacyCodexContextFingerprint,
  planLocalExecutionRecovery,
  singleRunOverrideIdentitySalt,
  type LocalExecutionSessionLinkFact,
} from "../src/local-console/execution-context.js";

const intent: LocalCodexResumeIntentFact = {
  sessionId: "session-a",
  intentId: "intent-a",
  targetRunId: "run-old",
  sourceMessageId: 7,
  role: "dev",
  reason: "graceful-shutdown",
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
    agentIdentityFingerprint: target.agentIdentityFingerprint,
    contextFingerprint: target.contextFingerprint,
    startedAt: "2026-07-25T00:00:02.000Z",
    ...overrides,
  };
}

describe("local execution recovery planning", () => {
  it("allows first creation only when the Agent identity has no provider evidence", () => {
    const current = context({ runId: "run-new", cli: "codex", markdown: "team" });
    expect(planLocalExecutionRecovery({
      sourceMessageId: 7,
      role: "dev",
      currentContext: current,
      intents: [],
      consumedIntentIds: new Set(),
      executionLinks: [],
      legacyCodexLinks: [],
      contexts: [],
    })).toMatchObject({
      kind: "first",
      reason: "no-provider-session",
    });
  });

  it("retries full with the frozen target context when the failed attempt never observed a provider id", () => {
    const old = context({ runId: "run-old", cli: "kimi", markdown: "old team" });
    const current = context({ runId: "run-new", cli: "codex", markdown: "new team" });
    expect(planLocalExecutionRecovery({
      sourceMessageId: 7,
      role: "dev",
      currentContext: current,
      intents: [{ ...intent, reason: "retry" }],
      consumedIntentIds: new Set(),
      executionLinks: [],
      legacyCodexLinks: [],
      contexts: [old],
    })).toMatchObject({
      kind: "first",
      intent: { targetRunId: "run-old" },
      context: { runId: "run-old", engine: "kimi" },
      reason: "no-provider-session",
    });
  });

  it("resumes an ordinary later turn with the unique compatible id", () => {
    const old = context({ runId: "run-old", cli: "kimi", markdown: "team" });
    const current = context({ runId: "run-new", cli: "kimi", markdown: "team" });
    expect(planLocalExecutionRecovery({
      sourceMessageId: 7,
      role: "dev",
      currentContext: current,
      intents: [],
      consumedIntentIds: new Set(),
      executionLinks: [link(old)],
      legacyCodexLinks: [],
      contexts: [old],
    })).toMatchObject({
      kind: "resume",
      externalSessionId: "external-a",
      canonicalLinkMissing: true,
    });
  });

  it("treats a switched team snapshot as a new Agent identity", () => {
    const old = context({ runId: "run-old", cli: "kimi", markdown: "old team" });
    const current = context({ runId: "run-new", cli: "codex", markdown: "new team" });
    expect(planLocalExecutionRecovery({
      sourceMessageId: 7,
      role: "dev",
      currentContext: current,
      intents: [],
      consumedIntentIds: new Set(),
      executionLinks: [link(old)],
      legacyCodexLinks: [],
      contexts: [old],
    })).toMatchObject({ kind: "first" });
  });

  it("migrates one compatible legacy Codex id without guessing by recency", () => {
    const old = context({ runId: "run-old", cli: "legacy", markdown: "legacy team" });
    const current = context({ runId: "run-new", cli: "legacy", markdown: "legacy team" });
    const plan = planLocalExecutionRecovery({
      sourceMessageId: 7,
      role: "dev",
      currentContext: current,
      intents: [],
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
      canonicalLinkMissing: true,
      context: { engine: "codex", profile: null },
    });
  });

  it("fails closed for conflicting ids and never selects the newest", () => {
    const old = context({ runId: "run-old", cli: "codex", markdown: "team" });
    const current = context({ runId: "run-new", cli: "codex", markdown: "team" });
    expect(planLocalExecutionRecovery({
      sourceMessageId: 7,
      role: "dev",
      currentContext: current,
      intents: [],
      consumedIntentIds: new Set(),
      executionLinks: [
        link(old, { externalSessionId: "thread-a" }),
        link({ ...old, runId: "run-other" }, {
          runId: "run-other",
          externalSessionId: "thread-b",
        }),
      ],
      legacyCodexLinks: [],
      contexts: [old, { ...old, runId: "run-other" }],
    })).toMatchObject({
      kind: "unavailable",
      reason: "session-link-conflict",
    });
  });

  it("fails closed when a graceful target context or observed provider id is missing", () => {
    const current = context({ runId: "run-new", cli: "codex", markdown: "team" });
    expect(planLocalExecutionRecovery({
      sourceMessageId: 7,
      role: "dev",
      currentContext: current,
      intents: [intent],
      consumedIntentIds: new Set(),
      executionLinks: [],
      legacyCodexLinks: [],
      contexts: [],
    })).toMatchObject({ kind: "unavailable", reason: "run-context-missing" });

    expect(planLocalExecutionRecovery({
      sourceMessageId: 7,
      role: "dev",
      currentContext: current,
      intents: [],
      consumedIntentIds: new Set(),
      observations: [{
        sessionId: "session-a",
        runId: "run-old",
        sourceMessageId: 7,
        role: "dev",
        engine: "codex",
        agentIdentityFingerprint: current.agentIdentityFingerprint,
        contextFingerprint: current.contextFingerprint,
        externalSessionId: null,
        observedAt: "2026-07-25T00:00:02.000Z",
      }],
      executionLinks: [],
      legacyCodexLinks: [],
      contexts: [],
    })).toMatchObject({ kind: "unavailable", reason: "provider-id-missing" });
  });

  it("runs a single-run override under a derived identity and leaves the base link resumable", () => {
    const base = context({ runId: "run-base", cli: "kimi", markdown: "team" });
    const overrideProfile = { cli: "codex", model: "gpt-5.6-sol", effort: "high" } as const;
    const override = createRunExecutionContext({
      sessionId: "session-a",
      runId: "run-override",
      sourceMessageId: 7,
      role: "dev",
      profile: overrideProfile,
      workspace: {
        cwd: "/tmp/project",
        mode: "direct",
        worktreePath: null,
        worktreeUnavailableReason: null,
        branchName: null,
        baseRef: null,
        originalRepoRoot: null,
      },
      team: base.team,
      identitySalt: singleRunOverrideIdentitySalt({
        overrideId: "override-1",
        profile: overrideProfile,
      }),
      recordedAt: "2026-07-25T00:00:03.000Z",
    });
    const overrideIntent: LocalCodexResumeIntentFact = {
      ...intent,
      reason: "retry",
      executionOverride: {
        overrideId: "override-1",
        profile: overrideProfile,
        scope: "single-run",
      },
    };

    expect(override.agentIdentityFingerprint).not.toBe(base.agentIdentityFingerprint);
    expect(planLocalExecutionRecovery({
      sourceMessageId: 7,
      role: "dev",
      currentContext: override,
      intents: [overrideIntent],
      consumedIntentIds: new Set(),
      canonicalLinks: [{
        sessionId: "session-a",
        role: "dev",
        engine: "kimi",
        externalSessionId: "kimi-base",
        profileFingerprint: base.profileFingerprint,
        agentIdentityFingerprint: base.agentIdentityFingerprint,
        contextFingerprint: base.contextFingerprint,
        linkedAt: "2026-07-25T00:00:02.000Z",
      }],
      executionLinks: [link(base, { externalSessionId: "kimi-base" })],
      legacyCodexLinks: [],
      contexts: [base],
    })).toMatchObject({
      kind: "first",
      context: {
        engine: "codex",
        identitySalt: singleRunOverrideIdentitySalt({
          overrideId: "override-1",
          profile: overrideProfile,
        }),
      },
    });

    const nextBase = context({ runId: "run-next", cli: "kimi", markdown: "team" });
    expect(planLocalExecutionRecovery({
      sourceMessageId: 7,
      role: "dev",
      currentContext: nextBase,
      intents: [],
      consumedIntentIds: new Set(),
      canonicalLinks: [{
        sessionId: "session-a",
        role: "dev",
        engine: "kimi",
        externalSessionId: "kimi-base",
        profileFingerprint: base.profileFingerprint,
        agentIdentityFingerprint: base.agentIdentityFingerprint,
        contextFingerprint: base.contextFingerprint,
        linkedAt: "2026-07-25T00:00:02.000Z",
      }],
      executionLinks: [link(base, { externalSessionId: "kimi-base" })],
      legacyCodexLinks: [],
      contexts: [base, override],
    })).toMatchObject({
      kind: "resume",
      externalSessionId: "kimi-base",
      context: { engine: "kimi" },
    });
  });
});
