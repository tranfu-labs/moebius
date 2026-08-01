import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { loadAgentContextStateStore } from "../src/agent-context-state.js";
import {
  githubRunnerSqlitePathForStateFile,
  legacySharedSqlitePathForStateFile,
  migrateLegacySharedGitHubState,
} from "../src/github-state-store.js";
import { loadGitHubResponseIntakeState, saveGitHubResponseIntakeState } from "../src/github-intake-state.js";
import type { GitHubResponseIntakeState } from "../src/github-response-intake.js";
import { createEmptyGoalLedgerState } from "../src/goal-ledger.js";
import { loadGoalLedgerState } from "../src/goal-ledger-state.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import {
  closeSqliteStateWorkers,
  runSqliteStateCommand,
  SqliteStateTimeoutError,
} from "../src/sqlite-state.js";
import { loadRoleThreadStateStore } from "../src/state.js";

describe("GitHub runner state store isolation", () => {
  afterEach(async () => {
    await closeSqliteStateWorkers();
  });

  it("keeps fresh local messages and GitHub intake writes in separate stores", async () => {
    const stateDir = path.join(await makeTempDir(), ".state");
    const intakePath = path.join(stateDir, "github-response-intake.json");
    const localPath = legacySharedSqlitePathForStateFile(intakePath);
    const githubPath = githubRunnerSqlitePathForStateFile(intakePath);

    await seedLocalMessage(localPath);
    await saveGitHubResponseIntakeState(representativeIntake("fresh"), intakePath);

    expect(countRows(localPath, "session_messages")).toBe(1);
    expect(countRows(localPath, "github_intake_issues")).toBe(0);
    expect(countRows(githubPath, "session_messages")).toBe(0);
    expect(countRows(githubPath, "github_intake_issues")).toBe(1);
  });

  it("migrates only GitHub runner state from the legacy shared SQLite store", async () => {
    const stateDir = path.join(await makeTempDir(), ".state");
    const intakePath = path.join(stateDir, "github-response-intake.json");
    const rolePath = path.join(stateDir, "role-threads.json");
    const contextPath = path.join(stateDir, "agent-contexts.json");
    const ledgerPath = path.join(stateDir, "goal-ledger.json");
    const legacyPath = legacySharedSqlitePathForStateFile(intakePath);
    const representative = representativeIntake("legacy");

    await seedLocalMessage(legacyPath);
    await runSqliteStateCommand({
      sqlitePath: legacyPath,
      command: { kind: "save-github-intake", state: representative },
    });
    await runSqliteStateCommand({
      sqlitePath: legacyPath,
      command: {
        kind: "save-role-threads",
        store: { "tranfu-labs/moebius#129": { dev: { threadId: "thread-129", lastSeenIndex: 22 } } },
      },
    });
    await runSqliteStateCommand({
      sqlitePath: legacyPath,
      command: {
        kind: "save-agent-contexts",
        store: {
          "tranfu-labs/moebius#129": {
            dev: {
              preScript: "workspaceAccess:issue-worktree",
              owner: "tranfu-labs",
              repo: "moebius",
              issueNumber: 129,
              worktreePath: "/tmp/issue-129",
              preparedFromMessageIndex: 22,
            },
          },
        },
      },
    });
    await runSqliteStateCommand({
      sqlitePath: legacyPath,
      command: { kind: "save-goal-ledger", state: createEmptyGoalLedgerState() },
    });
    const legacyBefore = await fs.stat(legacyPath);

    await expect(loadGitHubResponseIntakeState(intakePath)).resolves.toEqual(representative);
    await expect(loadRoleThreadStateStore(rolePath)).resolves.toMatchObject({
      "tranfu-labs/moebius#129": { dev: { threadId: "thread-129", lastSeenIndex: 22 } },
    });
    await expect(loadAgentContextStateStore(contextPath)).resolves.toHaveProperty(
      "tranfu-labs/moebius#129.dev.issueNumber",
      129,
    );
    await expect(loadGoalLedgerState(ledgerPath)).resolves.toEqual(createEmptyGoalLedgerState());

    const targetPath = githubRunnerSqlitePathForStateFile(intakePath);
    expect(countRows(legacyPath, "session_messages")).toBe(1);
    expect(countRows(targetPath, "session_messages")).toBe(0);
    expect(countRows(targetPath, "local_route_decisions")).toBe(0);
    expect(countRows(targetPath, "local_dead_letters")).toBe(0);
    expect(countRows(targetPath, "local_workspace_diffs")).toBe(0);
    const legacyAfter = await fs.stat(legacyPath);
    expect({ size: legacyAfter.size, mtimeMs: legacyAfter.mtimeMs }).toEqual({
      size: legacyBefore.size,
      mtimeMs: legacyBefore.mtimeMs,
    });
  });

  it("does not re-import legacy state over newer GitHub-mode state", async () => {
    const stateDir = path.join(await makeTempDir(), ".state");
    const intakePath = path.join(stateDir, "github-response-intake.json");
    const legacyPath = legacySharedSqlitePathForStateFile(intakePath);
    await runSqliteStateCommand({
      sqlitePath: legacyPath,
      command: { kind: "save-github-intake", state: representativeIntake("legacy") },
    });

    await expect(loadGitHubResponseIntakeState(intakePath)).resolves.toEqual(representativeIntake("legacy"));
    await saveGitHubResponseIntakeState(representativeIntake("newer"), intakePath);
    await runSqliteStateCommand({
      sqlitePath: legacyPath,
      command: { kind: "save-github-intake", state: representativeIntake("stale") },
    });

    await expect(loadGitHubResponseIntakeState(intakePath)).resolves.toEqual(representativeIntake("newer"));
  });

  it("fails within the configured bound when the GitHub-mode store is locked", async () => {
    const stateDir = path.join(await makeTempDir(), ".state");
    const intakePath = path.join(stateDir, "github-response-intake.json");
    const legacyPath = legacySharedSqlitePathForStateFile(intakePath);
    const targetPath = githubRunnerSqlitePathForStateFile(intakePath);
    await runSqliteStateCommand({
      sqlitePath: legacyPath,
      command: { kind: "save-github-intake", state: representativeIntake("legacy") },
    });
    await runSqliteStateCommand({
      sqlitePath: targetPath,
      command: { kind: "get-migration-status", source: "github-intake" },
    });

    const lock = new DatabaseSync(targetPath);
    lock.exec("BEGIN EXCLUSIVE");
    try {
      await expect(
        migrateLegacySharedGitHubState({
          filePath: intakePath,
          source: "github-intake",
          timeoutMs: 25,
        }),
      ).rejects.toBeInstanceOf(SqliteStateTimeoutError);
    } finally {
      lock.exec("ROLLBACK");
      lock.close();
    }
  });
});

async function seedLocalMessage(sqlitePath: string): Promise<void> {
  const now = "2026-07-11T00:00:00.000Z";
  const store = await createSqliteLocalConsoleStore({ sqlitePath });
  await store.init();
  try {
    await store.createSession({ sessionId: "local:representative", title: "Local", now });
    await store.appendUserMessage({ sessionId: "local:representative", body: "local-only", now });
  } finally {
    await store.close();
  }
}

function representativeIntake(label: string): GitHubResponseIntakeState {
  return {
    repositories: {
      "tranfu-labs/moebius": { lastIdleScanAt: `2026-07-11T00:00:0${label.length}.000Z` },
    },
    issues: {
      "tranfu-labs/moebius#129": {
        owner: "tranfu-labs",
        repo: "moebius",
        issueNumber: 129,
        updatedAt: `2026-07-11T00:01:0${label.length}.000Z`,
        mode: "active",
        activeNoChangeCount: 0,
        nextPollAt: null,
        lastFailureReason: label,
      },
    },
  };
}

function countRows(sqlitePath: string, table: string): number {
  const database = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    return row.count;
  } finally {
    database.close();
  }
}

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "moebius-github-state-store-"));
}
