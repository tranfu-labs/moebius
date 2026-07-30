import { describe, expect, it } from "vitest";

import { buildSessionReferenceText } from "../src/local-console/session-reference-text.js";

const links = [
  { runId: "run-a", engine: "codex" as const, externalSessionId: "codex-a" },
  { runId: "run-b", engine: "kimi" as const, externalSessionId: "kimi-b" },
  { runId: "run-c", engine: "claude" as const, externalSessionId: "claude-c" },
];

describe("session reference text", () => {
  it("keeps conversation references at record-path scope without guessing the latest run", () => {
    expect(buildSessionReferenceText({
      scope: "conversation",
      logPath: "/tmp/source.jsonl",
      runId: null,
      links,
    })).toBe("Moebius 会话记录：/tmp/source.jsonl");
  });

  it("matches a message reference to the exact run", () => {
    expect(buildSessionReferenceText({
      scope: "message",
      logPath: "/tmp/source.jsonl",
      runId: "run-a",
      links,
    })).toBe("Moebius 会话记录：/tmp/source.jsonl；外部执行：Codex codex-a");
  });

  it("labels a Claude message reference with its provider", () => {
    expect(buildSessionReferenceText({
      scope: "message",
      logPath: "/tmp/source.jsonl",
      runId: "run-c",
      links,
    })).toBe("Moebius 会话记录：/tmp/source.jsonl；外部执行：Claude claude-c");
  });

  it("makes a missing message execution explicit", () => {
    expect(buildSessionReferenceText({
      scope: "message",
      logPath: "/tmp/source.jsonl",
      runId: "run-missing",
      links,
    })).toBe("Moebius 会话记录：/tmp/source.jsonl；外部执行：未建立");
  });
});
