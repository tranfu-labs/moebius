import { describe, expect, it } from "vitest";

import {
  decideRunOutputFileRead,
  planRunOutputSource,
} from "../src/local-console/run-output-plan.js";
import type { LocalConsoleMessage } from "../src/local-console/types.js";

describe("local console run output plan", () => {
  it("uses the active run directory and role over persisted history", () => {
    const source = planRunOutputSource({
      sessionId: "session-1",
      messages: [{ runDir: "/historical", role: "dev", error: null, body: "partial" } as LocalConsoleMessage],
      active: { sessionId: "session-1", runDir: "/active", role: "qa" },
    });

    expect(source).toEqual({
      kind: "read",
      runDir: "/active",
      role: "qa",
      fallback: "partial",
    });
    if (source.kind !== "read") throw new Error("expected output source");
    expect(decideRunOutputFileRead(source.runDir)).toEqual({ kind: "read", runDir: "/active" });
  });

  it("returns historical fallback without inventing an output directory", () => {
    expect(planRunOutputSource({
      sessionId: "session-1",
      messages: [{ runDir: null, role: "dev", error: "failed", body: "ignored" } as LocalConsoleMessage],
      active: undefined,
    })).toEqual({ kind: "read", runDir: null, role: "dev", fallback: "failed" });
    expect(decideRunOutputFileRead(null)).toEqual({ kind: "skip" });
  });

  it("distinguishes an unknown run from an active run in another session", () => {
    expect(planRunOutputSource({
      sessionId: "session-1",
      messages: [],
      active: { sessionId: "session-2", runDir: "/active", role: "qa" },
    })).toEqual({ kind: "missing" });
  });
});
