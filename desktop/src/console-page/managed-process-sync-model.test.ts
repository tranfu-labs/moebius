import { describe, expect, it } from "vitest";

import {
  decideManagedProcessLogPolling,
  planManagedProcessLogCommit,
  planManagedProcessLogCursor,
} from "./managed-process-sync-model";

describe("managed process log synchronization", () => {
  it("reuses cursors only from settled log reads and preserves the tail on unchanged responses", () => {
    const previous = {
      status: "ready" as const,
      stdout: "tail",
      stderr: "",
      truncated: true,
      cursor: "old",
      message: "stale failure",
    };
    expect(planManagedProcessLogCursor(previous)).toBe("old");
    expect(planManagedProcessLogCursor({ status: "loading" })).toBeUndefined();
    expect(planManagedProcessLogCommit(previous, {
      status: "ready",
      stdout: "",
      stderr: "",
      truncated: true,
      cursor: "next",
      unchanged: true,
    })).toEqual({ ...previous, cursor: "next", message: undefined });
  });

  it("polls viewed logs only while the panel is open", () => {
    expect(decideManagedProcessLogPolling(true)).toBe("poll");
    expect(decideManagedProcessLogPolling(false)).toBe("skip");
  });
});
