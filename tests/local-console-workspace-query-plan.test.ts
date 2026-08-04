import { describe, expect, it } from "vitest";

import {
  planProjectFiles,
  planUnavailableProjectFiles,
} from "../src/local-console/workspace-query-plan.js";

describe("local console workspace query plan", () => {
  it("joins workspace files with changed-line metadata", () => {
    const diff = {
      available: true as const,
      fileCount: 1,
      files: [{ path: "src/changed.ts", additions: 3, deletions: 1 }],
      reason: null,
    };

    expect(planProjectFiles({
      filePaths: ["README.md", "src/changed.ts"],
      diff,
      workspaceMode: "worktree",
    })).toEqual({
      available: true,
      files: [
        { path: "README.md", additions: null, deletions: null, changed: false },
        { path: "src/changed.ts", additions: 3, deletions: 1, changed: true },
      ],
      reason: null,
      workspaceMode: "worktree",
    });
  });

  it("preserves the selected workspace mode when reading is unavailable", () => {
    expect(planUnavailableProjectFiles("direct")).toEqual({
      available: false,
      files: [],
      reason: "workspace-unavailable",
      workspaceMode: "direct",
    });
  });
});
