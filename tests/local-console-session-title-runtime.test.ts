import { describe, expect, it, vi } from "vitest";

import {
  LocalConsoleSessionTitleRuntime,
  type SessionTitleOneShotPort,
  type SessionTitleRuntimeInput,
} from "../src/local-console/session-title-runtime.js";

function makeRuntime(overrides: Partial<SessionTitleRuntimeInput> = {}): {
  runtime: LocalConsoleSessionTitleRuntime;
  renameSession: ReturnType<typeof vi.fn>;
  reportError: ReturnType<typeof vi.fn>;
  oneShot: { run: ReturnType<typeof vi.fn> };
} {
  const oneShot = {
    run: vi.fn<SessionTitleOneShotPort["run"]>(async () => ({ ok: true, text: "改进推特推广" })),
  };
  const renameSession = vi.fn<SessionTitleRuntimeInput["renameSession"]>(
    async () => ({ sessionId: "session-1" }) as never,
  );
  const reportError = vi.fn();
  const runtime = new LocalConsoleSessionTitleRuntime({
    nowIso: () => "2026-08-16T00:00:00.000Z",
    makeTitleRunDir: (sessionId) => `/tmp/title/${sessionId}`,
    oneShot,
    sessionPrimaryProfile: async () => null,
    renameSession,
    reportError,
    ...overrides,
  });
  return { runtime, renameSession, reportError, oneShot };
}

describe("session title generation runtime", () => {
  it("renames with the sanitized title and expectedTitleRevision 0", async () => {
    const { runtime, renameSession } = makeRuntime();
    await runtime.generateTitle("session-1", "推特效果平平，想改进推广");

    expect(renameSession).toHaveBeenCalledExactlyOnceWith({
      sessionId: "session-1",
      title: "改进推特推广",
      expectedTitleRevision: 0,
      now: "2026-08-16T00:00:00.000Z",
    });
  });

  it("extracts a JSON-shaped provider output before renaming", async () => {
    const { runtime, renameSession, oneShot } = makeRuntime();
    oneShot.run.mockResolvedValue({ ok: true, text: '{"title": "改进推特推广"}' });
    await runtime.generateTitle("session-1", "推特效果平平");

    expect(renameSession).toHaveBeenCalledWith(expect.objectContaining({ title: "改进推特推广" }));
  });

  it("keeps the default title when the provider output is unusable", async () => {
    const { runtime, renameSession, oneShot } = makeRuntime();
    oneShot.run.mockResolvedValue({ ok: true, text: "。。。" });
    await runtime.generateTitle("session-1", "hi");

    expect(renameSession).not.toHaveBeenCalled();
  });

  it("keeps the default title when the one-shot call fails without reporting", async () => {
    const { runtime, renameSession, reportError, oneShot } = makeRuntime();
    oneShot.run.mockResolvedValue({ ok: false, reason: "provider quota exhausted" });
    await runtime.generateTitle("session-1", "msg");

    expect(renameSession).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("treats a manual-rename race as a normal outcome", async () => {
    const { runtime, reportError, renameSession } = makeRuntime();
    renameSession.mockRejectedValue(new Error("SESSION_SIDEBAR_STATE_STALE"));
    await runtime.generateTitle("session-1", "msg");

    expect(reportError).not.toHaveBeenCalled();
  });

  it("treats a vanished session as a normal outcome", async () => {
    const { runtime, reportError, renameSession } = makeRuntime();
    renameSession.mockRejectedValue(new Error("local console session not found: session-1"));
    await runtime.generateTitle("session-1", "msg");

    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports unexpected failures", async () => {
    const { runtime, reportError, renameSession } = makeRuntime();
    renameSession.mockRejectedValue(new Error("sqlite busy"));
    await runtime.generateTitle("session-1", "msg");

    expect(reportError).toHaveBeenCalledExactlyOnceWith(
      "local-console-session-title-generation-failed",
      "sqlite busy",
    );
  });

  it("deduplicates concurrent generations for the same session", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { runtime, oneShot } = makeRuntime();
    let calls = 0;
    oneShot.run.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) await gate;
      return { ok: true, text: "标题" };
    });

    const first = runtime.generateTitle("session-1", "msg");
    const second = runtime.generateTitle("session-1", "msg");
    release();
    await Promise.all([first, second]);

    expect(calls).toBe(1);
  });

  it("allows a fresh generation after the previous one settles", async () => {
    const { runtime, oneShot } = makeRuntime();
    await runtime.generateTitle("session-1", "msg");
    await runtime.generateTitle("session-1", "msg");

    expect(oneShot.run).toHaveBeenCalledTimes(2);
  });

  it("passes the session primary profile to the one-shot port", async () => {
    const { runtime, oneShot } = makeRuntime({
      sessionPrimaryProfile: async () => ({
        cli: "codex",
        model: "gpt-5.2-codex",
        effort: "medium",
      }),
    });
    await runtime.generateTitle("session-1", "msg");

    expect(oneShot.run).toHaveBeenCalledWith(expect.objectContaining({
      profile: { cli: "codex", model: "gpt-5.2-codex", effort: "medium" },
    }));
  });
});
