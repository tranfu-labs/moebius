import { describe, expect, it } from "vitest";

import { selectAiTeamBuilderProfileFromSnapshots } from "../src/ai-team-builder/execution-profile.js";
import {
  capabilitySnapshotId,
  type ExecutionCapabilitySnapshot,
} from "../src/team-execution-profile.js";

describe("AI team builder execution profile selection", () => {
  it("prefers server-probed Codex and otherwise selects server-probed Kimi", () => {
    const codex = available("codex", "gpt-preferred", ["medium", "high"], "medium");
    const kimi = available("kimi", "kimi-for-coding", ["high"], "high");

    expect(selectAiTeamBuilderProfileFromSnapshots({
      codex,
      kimi,
      preferredCodexModel: "gpt-preferred",
    })).toEqual({ cli: "codex", model: "gpt-preferred", effort: "medium" });
    expect(selectAiTeamBuilderProfileFromSnapshots({
      codex: unavailable("codex"),
      kimi,
    })).toEqual({ cli: "kimi", model: "kimi-for-coding", effort: "high" });
  });
});

function available(
  cli: "codex" | "kimi",
  model: string,
  efforts: string[],
  defaultEffort: string,
): ExecutionCapabilitySnapshot {
  const input = {
    cli,
    cliVersion: "1.0.0",
    status: "available" as const,
    models: [{ id: model, displayName: model, efforts, defaultEffort }],
  };
  return {
    ...input,
    snapshotId: capabilitySnapshotId(input),
    checkedAt: "2026-07-26T00:00:00.000Z",
  };
}

function unavailable(cli: "codex" | "kimi"): ExecutionCapabilitySnapshot {
  const input = {
    cli,
    cliVersion: null,
    status: "missing" as const,
    models: [],
  };
  return {
    ...input,
    snapshotId: capabilitySnapshotId(input),
    checkedAt: "2026-07-26T00:00:00.000Z",
  };
}
