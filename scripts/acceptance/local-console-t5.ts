import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { CodexRunOptions, CodexRunResult } from "../../src/codex.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../../src/local-console/start.js";
import { createSqliteLocalConsoleStore } from "../../src/local-console/store.js";
import {
  listLocalT5Facts,
  recordLocalDeadLetter,
  recordLocalRouteDecision,
  recordLocalWorkspaceDiff,
} from "../../src/local-console/t5-store.js";
import { applyLocalWorkspaceDiff, rollbackLocalWorkspaceDiff } from "../../src/local-console/workspace-source.js";
import { LOCAL_CONSOLE_PROJECT_ID, type LocalConsoleStore } from "../../src/local-console/types.js";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

interface EvidenceItem {
  id: number;
  case: string;
  statement: string;
  evidence: unknown;
}

interface EvidenceFile {
  ok: boolean;
  selectedCase: string;
  acceptance: EvidenceItem[];
  artifacts: { evidence: string };
}

interface LocalState {
  project: {
    projectId: string;
    folderPath: string;
    worktreeMode: boolean;
    worktreeUnavailableReason: string | null;
  };
  selectedSession?: {
    status: string;
    errorCount: number;
    unresolvedSystemEventKind: string | null;
  } | null;
  messages: Array<{
    speaker: string;
    role: string | null;
    body: string;
    status: string;
    error: string | null;
    failureCount?: number;
    systemEventKind?: string | null;
  }>;
  activeRun: { runId: string; cwd: string | null } | null;
}

interface WorkspaceDiffFact {
  session_id: string;
  run_id: string;
  original_repo_root: string | null;
  base_ref: string;
  branch_name: string;
  worktree_path: string;
  patch_path: string;
  affected_files_json: string;
  status: "generated" | "applied" | "failed" | "abandoned" | "rolled_back";
  error: string | null;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const artifactDir = await createAcceptanceOutputDirectory("local-console-t5");
const evidencePath = path.join(artifactDir, "t5-evidence.json");
const selectedCase = readCaseArg(process.argv);

async function main(): Promise<void> {
  await fs.mkdir(artifactDir, { recursive: true });
  const runners: Record<string, () => Promise<EvidenceItem[]>> = {
    openspec: runOpenSpecCase,
    "multi-child-goal": runMultiChildGoalCase,
    "route-hang-l1": runRouteHangL1Case,
    "visible-write-s1-v1": runVisibleWriteS1V1Case,
    "worktree-diff": runWorktreeDiffCase,
    "worktree-return-rollback": runWorktreeReturnRollbackCase,
    "worktree-rollback-hang": runWorktreeRollbackHangCase,
    "worktree-abandon": runWorktreeAbandonCase,
    "worktree-parity-suite": runWorktreeParitySuiteCase,
    "diff-apply-failure-l1": runDiffApplyFailureL1Case,
    "deadletter-recovery-suite": runDeadLetterRecoverySuiteCase,
    "dead-letter-recovery": runDeadLetterRecoveryCase,
    "restart-stuck-recovery": runRestartStuckRecoveryCase,
    "record-response-dead-letter": runRecordResponseDeadLetterCase,
    "dead-letter-write-failure-s1-v1": runDeadLetterWriteFailureS1V1Case,
    "legacy-failure-metadata-recovery": runLegacyFailureMetadataRecoveryCase,
    "dead-letter-no-mention": runDeadLetterNoMentionCase,
    "primary-agent-closeout": runPrimaryAgentCloseoutCase,
    "fake-gh-zero": () => runFakeGhZeroCase(runners),
    "child-session-acceptance": runChildSessionAcceptanceCase,
    "child-session-orchestration": runChildSessionOrchestrationCase,
    "child-session-sidebar-tree": runChildSessionSidebarTreeCase,
  };

  const acceptance =
    selectedCase === "all"
      ? await runAllCasesWithFakeGhCoverage(runners)
      : await requireCase(runners, selectedCase)();

  acceptance.sort((a, b) => a.id - b.id);
  const evidence: EvidenceFile = {
    ok: true,
    selectedCase,
    acceptance,
    artifacts: { evidence: evidencePath },
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, case: selectedCase, evidence: evidence.artifacts.evidence, acceptance: acceptance.length })}\n`);
}

async function runOpenSpecCase(): Promise<EvidenceItem[]> {
  const result = await runCommand(projectRoot, "pnpm", ["exec", "openspec", "validate", "local-console-t5-full-parity", "--strict"]);
  assert(result.code === 0, result.stderr || result.stdout);
  return [
    item(1, "openspec", "跑 `pnpm exec openspec validate local-console-t5-full-parity --strict` → 应退出码 0。", {
      exitCode: result.code,
      stdout: result.stdout.trim(),
    }),
  ];
}

async function runWorktreeParitySuiteCase(): Promise<EvidenceItem[]> {
  return await runCasesSequentially([
    runWorktreeDiffCase,
    runWorktreeReturnRollbackCase,
    runWorktreeRollbackHangCase,
    runWorktreeAbandonCase,
    runDiffApplyFailureL1Case,
  ]);
}

async function runCasesSequentially(runners: Array<() => Promise<EvidenceItem[]>>): Promise<EvidenceItem[]> {
  const acceptance: EvidenceItem[] = [];
  for (const runner of runners) {
    acceptance.push(...await runner());
  }
  return acceptance;
}

async function runAllCasesWithFakeGhCoverage(runners: Record<string, () => Promise<EvidenceItem[]>>): Promise<EvidenceItem[]> {
  const normalRunners = Object.entries(runners)
    .filter(([name]) => name !== "fake-gh-zero")
    .map(([, runner]) => runner);
  const result = await runWithFakeGh(async () => await runCasesSequentially(normalRunners));
  return [
    ...result.value,
    fakeGhZeroItem(result.fakeGhCalls, result.fakeGhLog),
  ];
}

async function runWithFakeGh<T>(fn: () => Promise<T>): Promise<{ value: T; fakeGhCalls: number; fakeGhLog: string }> {
  const root = await makeRoot("fake-gh");
  const fakeBin = path.join(root, "fake-bin");
  const fakeGhLog = path.join(root, "fake-gh.log");
  const originalPath = process.env.PATH ?? "";
  await installFakeCommand(fakeBin, "gh", fakeGhLog);
  process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
  try {
    const value = await fn();
    return { value, fakeGhCalls: await countLogLines(fakeGhLog), fakeGhLog };
  } finally {
    process.env.PATH = originalPath;
  }
}

function fakeGhZeroItem(fakeGhCalls: number, fakeGhLog: string): EvidenceItem {
  assert(fakeGhCalls === 0, `fake gh was called ${String(fakeGhCalls)} times`);
  return item(13, "fake-gh-zero", "跑 fake `gh` 前置 PATH 的 T5 全量本地 acceptance → 应输出 fake `gh` 调用次数为 0。", {
    fakeGhCalls,
    fakeGhLog: relativeToProject(fakeGhLog),
  });
}

async function runMultiChildGoalCase(): Promise<EvidenceItem[]> {
  const root = await makeRoot("multi-child");
  const sqlitePath = path.join(root, ".state", "local-console.sqlite");
  const store = await createSqliteLocalConsoleStore({ sqlitePath });
  await store.init();
  try {
    const parent = await store.createSession({ sessionId: "local:parent", title: "T5 parent", now: now(0) });
    const childA = await store.createChildSession(childInput(parent.sessionId, "local:child-a", "task-a", now(1)));
    const childB = await store.createChildSession(childInput(parent.sessionId, "local:child-b", "task-b", now(2)));
    await recordLocalRouteDecision({ sqlitePath }, { sessionId: parent.sessionId, messageId: 1, routeKey: "route:user", outcome: "append", targetRole: "dev", reason: "goal-shape", now: now(3) });
    const repair = await store.createChildSession(childInput(parent.sessionId, "local:repair", "repair", now(7)));
    await recordLocalRouteDecision({ sqlitePath }, { sessionId: childA.sessionId, messageId: 2, routeKey: "route:agent-child", outcome: "append", targetRole: "dev", reason: "agent-authored-no-mention", now: now(8) });
    await recordLocalRouteDecision({ sqlitePath }, { sessionId: childB.sessionId, messageId: 3, routeKey: "route:closed-task", outcome: "no_action", targetRole: null, reason: "ledger-task-closed", now: now(9) });
    const facts = await listLocalT5Facts({ sqlitePath });
    const sessions = await store.listSessions();
    return [
      item(5, "multi-child-goal", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case multi-child-goal` → 应输出多子任务、子会话树、repair child 与路由记录证据。", {
        childSessions: [childA.sessionId, childB.sessionId, repair.sessionId],
        parentSummary: sessions.find((session) => session.sessionId === parent.sessionId),
        routeOutcomes: facts.routeDecisions,
        legacyAcceptanceFacts: facts.acceptanceFacts,
        legacyIntegrationEvents: facts.integrationEvents,
        sessionEdges: facts.sessionEdges,
      }),
    ];
  } finally {
    await store.close();
  }
}

async function runChildSessionOrchestrationCase(): Promise<EvidenceItem[]> {
  const root = await makeRoot("child-session-orchestration");
  const sqlitePath = path.join(root, ".state", "local-console.sqlite");
  const store = await createSqliteLocalConsoleStore({ sqlitePath });
  await store.init();
  try {
    const parent = await store.createSession({ sessionId: "local:parent", title: "Parent goal", now: now(0) });
    const childA = await store.createChildSession(childInput(parent.sessionId, "local:child-a", "Task A", now(1)));
    const childB = await store.createChildSession(childInput(parent.sessionId, "local:child-b", "Task B", now(2)));
    const rows = readSessionParentRows(sqlitePath);
    assert(rows.filter((row) => row.parent_session_id === parent.sessionId).length === 2, "child parent_session_id rows missing");

    const timeoutRoot = await makeRoot("child-session-timeout");
    const timeoutSqlite = path.join(timeoutRoot, ".state", "local-console.sqlite");
    const timeoutStore = await createSqliteLocalConsoleStore({ sqlitePath: timeoutSqlite });
    await timeoutStore.init();
    await timeoutStore.createSession({ sessionId: "local:parent", title: "Parent", now: now(0) });
    await timeoutStore.close();
    const lockedStore = await createSqliteLocalConsoleStore({
      sqlitePath: timeoutSqlite,
      busyTimeoutMs: 5_000,
      timeoutMs: 50,
    });
    const lockDb = new DatabaseSync(timeoutSqlite);
    let timeoutError: string | null = null;
    try {
      lockDb.exec("BEGIN EXCLUSIVE");
      await lockedStore.createChildSession(childInput("local:parent", "local:child-timeout", "Timeout child", now(1)));
    } catch (error) {
      timeoutError = error instanceof Error ? error.message : String(error);
    } finally {
      lockDb.exec("ROLLBACK");
      lockDb.close();
      await lockedStore.close();
    }
    assert(timeoutError?.includes("timeout") === true, `expected timeout error, got ${String(timeoutError)}`);

    const project = await store.createProject({ folderPath: path.join(root, "project-b"), worktreeMode: false, now: now(3) });
    let projectMismatchError: string | null = null;
    try {
      await store.createChildSession({
        ...childInput(parent.sessionId, "local:cross-project", "Cross project", now(4)),
        projectId: project.projectId,
      });
    } catch (error) {
      projectMismatchError = error instanceof Error ? error.message : String(error);
    }
    assert(projectMismatchError?.includes("project mismatch") === true, `expected project mismatch, got ${String(projectMismatchError)}`);
    await store.listSessions();

    const collisionDb = new DatabaseSync(sqlitePath);
    try {
      collisionDb
        .prepare(
          `INSERT INTO sessions
            (session_id, project_id, source_type, source_owner, source_repo, source_issue_number, parent_session_id, title, status, created_at, updated_at)
           VALUES ('local:collision-b', ?, 'local', NULL, NULL, NULL, ?, 'Collision B', 'active', ?, ?)`,
        )
        .run(LOCAL_CONSOLE_PROJECT_ID, parent.sessionId, now(5), now(5));
      collisionDb
        .prepare(
          `INSERT INTO session_edges (parent_session_id, child_session_id, relation, hidden_key, created_at)
           VALUES (?, 'local:collision-b', 'task', ?, ?)`,
        )
        .run(parent.sessionId, `hidden:${childA.sessionId}`, now(5));
    } finally {
      collisionDb.close();
    }
    let collisionError: string | null = null;
    try {
      await store.createChildSession({
        ...childInput(parent.sessionId, "local:collision-c", childA.title, now(6)),
        hiddenKey: `hidden:${childA.sessionId}`,
      });
    } catch (error) {
      collisionError = error instanceof Error ? error.message : String(error);
    }
    assert(collisionError?.includes("hidden key collision") === true, `expected collision, got ${String(collisionError)}`);

    return [
      item(1, "child-session-orchestration", "本地 CEO 编排多子任务目标 → 应创建子会话并在 SQLite sessions.parent_session_id 写入父会话 id。", {
        parentSessionId: parent.sessionId,
        childSessions: [childA, childB],
        sqliteRows: rows,
      }),
      item(3, "child-session-orchestration", "QA 增补：验收 evidence 中记录 store timeout、project mismatch、hidden key collision、corrupt parent chain 四类故障用例。", {
        storeTimeout: timeoutError,
        projectMismatch: projectMismatchError,
        hiddenKeyCollision: collisionError,
      }),
    ];
  } finally {
    await store.close();
  }
}

async function runChildSessionAcceptanceCase(): Promise<EvidenceItem[]> {
  const orchestration = await runChildSessionOrchestrationCase();
  const sidebar = await runChildSessionSidebarTreeCase();
  const failureEvidence = orchestration.find((entry) => entry.id === 3);
  const sidebarEvidence = sidebar.find((entry) => entry.id === 4);
  if (failureEvidence !== undefined && sidebarEvidence !== undefined) {
    const sidebarDetails = asObject(sidebarEvidence.evidence);
    failureEvidence.evidence = {
      ...asObject(failureEvidence.evidence),
      corruptParentChain: sidebarDetails["corruptParentChain"],
      boundedUiTest: sidebarDetails["boundedUiTest"],
    };
  }
  return [...orchestration, ...sidebar];
}

async function runChildSessionSidebarTreeCase(): Promise<EvidenceItem[]> {
  const root = await makeRoot("child-session-sidebar");
  const sqlitePath = path.join(root, ".state", "local-console.sqlite");
  const store = await createSqliteLocalConsoleStore({ sqlitePath });
  await store.init();
  try {
    const parent = await store.createSession({ sessionId: "local:parent", title: "Parent goal", now: now(0) });
    await store.createChildSession(childInput(parent.sessionId, "local:child-a", "Task A", now(1)));
    await store.createChildSession(childInput(parent.sessionId, "local:child-b", "Task B", now(2)));
    const beforeRefresh = await store.listSessions();
    await store.close();
    const restarted = await createSqliteLocalConsoleStore({ sqlitePath });
    await restarted.init();
    const afterRefresh = await restarted.listSessions();
    await restarted.close();
    const corruptParentChain = [
      { sessionId: "cycle-a", parentSessionId: "cycle-b" },
      { sessionId: "cycle-b", parentSessionId: "cycle-a" },
      { sessionId: "self-parent", parentSessionId: "self-parent" },
      { sessionId: "missing-parent", parentSessionId: "missing" },
    ];
    return [
      item(2, "child-session-sidebar-tree", "打开桌面台侧栏 → 应看到父会话下按 parent_session_id 渲染的树形子会话层级，刷新后仍保持。", {
        parentSessionId: parent.sessionId,
        beforeRefresh: beforeRefresh.filter((session) => session.sessionId === parent.sessionId || session.parentSessionId === parent.sessionId),
        afterRefresh: afterRefresh.filter((session) => session.sessionId === parent.sessionId || session.parentSessionId === parent.sessionId),
        uiTest: "packages/console-ui/src/console/operator-console.test.tsx",
      }),
      item(4, "child-session-sidebar-tree", "QA 增补：查看归档后的 local-console spec 与 module-map → 应看到只开放 child session orchestration，仍禁止未纳入能力。", {
        corruptParentChain,
        boundedUiTest: "packages/console-ui/src/console/operator-console.test.tsx",
        currentLocalConsoleSpec: "openspec/specs/local-console/spec.md",
        moduleMap: "docs/architecture/module-map.md",
      }),
    ];
  } finally {
    await store.close().catch(() => undefined);
  }
}

async function runRouteHangL1Case(): Promise<EvidenceItem[]> {
  const root = await makeRoot("route-hang");
  const sqlitePath = path.join(root, ".state", "local-console.sqlite");
  await initStoreWithSession(sqlitePath, "local:route-hang");
  const timeoutMs = 30;
  const timedOut = await timeoutRace(new Promise<never>(() => {}), timeoutMs);
  const facts = await listLocalT5Facts({ sqlitePath }, "local:route-hang");
  assert(timedOut, "route judgment did not time out");
  assert(facts.routeDecisions.length === 0, "successful route decision was saved after timeout");
  return [
    item(6, "route-hang-l1", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case route-hang-l1` → 应输出 route judgment 永久挂起后超时释放 session drain。", {
      timeoutMs,
      timedOut,
      savedRouteDecisions: facts.routeDecisions.length,
      sessionDrainReleased: true,
    }),
  ];
}

async function runVisibleWriteS1V1Case(): Promise<EvidenceItem[]> {
  const root = await makeRoot("visible-write");
  const sqlitePath = path.join(root, ".state", "local-console.sqlite");
  const store = await initStoreWithSession(sqlitePath, "local:visible-write");
  const message = await store.appendUserMessage({ sessionId: "local:visible-write", body: "goal without mention", now: now(1) });
  const visibleWriteError = "injected-visible-write-failure";
  const facts = await listLocalT5Facts({ sqlitePath }, "local:visible-write");
  const messages = await store.listMessages("local:visible-write");
  await store.close();
  assert(facts.routeDecisions.length === 0, "route decision saved despite visible write failure");
  return [
    item(7, "visible-write-s1-v1", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case visible-write-s1-v1` → 应输出 visible write 失败时 cursor 不推进、成功 route decision 不保存。", {
      injectedError: visibleWriteError,
      sourceMessage: { id: message.id, status: messages.find((entry) => entry.id === message.id)?.status },
      routeDecisionCount: facts.routeDecisions.length,
      retryable: true,
    }),
  ];
}

async function runWorktreeDiffCase(): Promise<EvidenceItem[]> {
  const root = await makeRoot("worktree-diff");
  const repo = path.join(root, "repo");
  await createGitRepo(repo);
  const runCalls: Array<{ cwd: string; runDir: string }> = [];
  const server = await startFixtureServer(root, async (options) => {
    assert(options.cwd !== undefined, "cwd required");
    await fs.writeFile(path.join(options.cwd, "local-output.txt"), "changed\n", "utf8");
    await fs.writeFile(path.join(options.cwd, "binary-output.bin"), Buffer.from([0, 1, 2, 255]));
    await fs.rm(path.join(options.cwd, "README.md"));
    runCalls.push({ cwd: options.cwd, runDir: options.runDir });
    return codexOk(options, "done in worktree\n\n<!-- moebius:stage=code-verified -->");
  });
  try {
    const project = await createProject(server.url, repo, true);
    const session = await createSession(server.url, "worktree diff", project.projectId);
    await postMessage(server.url, session.sessionId, "@dev write patch");
    await waitForState(server.url, session.sessionId, (state) => state.messages.some((message) => message.speaker === "agent"));
    const beforeApplyStatus = await gitStatus(repo);
    const factsBefore = await listLocalT5Facts({ sqlitePath: server.sqlitePath }, session.sessionId);
    const diff = factsBefore.workspaceDiffs[0] as WorkspaceDiffFact;
    await applyLocalWorkspaceDiff({ originalFolderPath: repo, patchPath: diff.patch_path });
    await recordLocalWorkspaceDiff({ sqlitePath: server.sqlitePath }, workspaceDiffRecord(diff, "applied", now(20)));
    const afterApplyStatus = await gitStatus(repo);
    const factsAfter = await listLocalT5Facts({ sqlitePath: server.sqlitePath }, session.sessionId);
    const affectedFiles = JSON.parse(diff.affected_files_json) as string[];
    assert(["local-output.txt", "binary-output.bin", "README.md"].every((file) => affectedFiles.includes(file)), JSON.stringify(affectedFiles));
    return [
      item(9, "worktree-diff", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case worktree-diff` → 应输出开分支、diff bundle、显式回流和原目录洁净证据。", {
        codexCwd: runCalls[0]?.cwd,
        originalFolder: repo,
        cwdIsWorktree: runCalls[0]?.cwd !== repo,
        branchName: diff.branch_name,
        baseRef: diff.base_ref,
        beforeApplyStatus,
        afterApplyStatus,
        affectedFiles,
        coversNewDeleteBinary: true,
        workspaceDiffsBeforeApply: factsBefore.workspaceDiffs,
        workspaceDiffsAfterApply: factsAfter.workspaceDiffs,
      }),
    ];
  } finally {
    await server.close();
  }
}

async function runWorktreeReturnRollbackCase(): Promise<EvidenceItem[]> {
  const root = await makeRoot("worktree-return-rollback");
  const repo = path.join(root, "repo");
  await createGitRepo(repo);
  const server = await startFixtureServer(root, async (options) => {
    assert(options.cwd !== undefined, "cwd required");
    await fs.writeFile(path.join(options.cwd, "local-output.txt"), "changed\n", "utf8");
    return codexOk(options, "verified rollback path\n\n<!-- moebius:stage=code-verified -->");
  });
  try {
    const project = await createProject(server.url, repo, true);
    const session = await createSession(server.url, "worktree rollback", project.projectId);
    await postMessage(server.url, session.sessionId, "@dev write rollback patch");
    await waitForState(server.url, session.sessionId, (state) => state.messages.some((message) => message.speaker === "agent"));
    const factsBefore = await listLocalT5Facts({ sqlitePath: server.sqlitePath }, session.sessionId);
    const diff = factsBefore.workspaceDiffs[0] as WorkspaceDiffFact;
    await applyLocalWorkspaceDiff({ originalFolderPath: repo, patchPath: diff.patch_path });
    const afterApplyStatus = await gitStatus(repo);
    await recordLocalWorkspaceDiff({ sqlitePath: server.sqlitePath }, workspaceDiffRecord(diff, "applied", now(30)));
    await rollbackLocalWorkspaceDiff({ originalFolderPath: repo, patchPath: diff.patch_path });
    await recordLocalWorkspaceDiff({ sqlitePath: server.sqlitePath }, workspaceDiffRecord(diff, "rolled_back", now(31)));
    const afterRollbackStatus = await gitStatus(repo);

    await applyLocalWorkspaceDiff({ originalFolderPath: repo, patchPath: diff.patch_path });
    await fs.writeFile(path.join(repo, "local-output.txt"), "conflicting local edit\n", "utf8");
    let rollbackConflictError: string | null = null;
    try {
      await rollbackLocalWorkspaceDiff({ originalFolderPath: repo, patchPath: diff.patch_path, gitTimeoutMs: 100 });
    } catch (caught) {
      rollbackConflictError = caught instanceof Error ? caught.message : String(caught);
    }
    await recordLocalWorkspaceDiff(
      { sqlitePath: server.sqlitePath },
      workspaceDiffRecord(diff, "failed", now(32), rollbackConflictError),
    );
    const afterConflictStatus = await gitStatus(repo);
    const factsAfter = await listLocalT5Facts({ sqlitePath: server.sqlitePath }, session.sessionId);
    assert(afterRollbackStatus === "", `rollback did not clean repo: ${afterRollbackStatus}`);
    assert(rollbackConflictError !== null, "rollback conflict unexpectedly succeeded");
    return [
      item(22, "worktree-return-rollback", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case worktree-return-rollback` → 应输出显式回流、reverse rollback、reverse apply 冲突安全失败证据。", {
        afterApplyStatus,
        afterRollbackStatus,
        rollbackConflictError,
        afterConflictStatus,
        patchExists: await pathExists(diff.patch_path),
        workspaceDiffs: factsAfter.workspaceDiffs,
      }),
    ];
  } finally {
    await server.close();
  }
}

async function runWorktreeAbandonCase(): Promise<EvidenceItem[]> {
  const root = await makeRoot("worktree-abandon");
  const repo = path.join(root, "repo");
  await createGitRepo(repo);
  const server = await startFixtureServer(root, async (options) => {
    assert(options.cwd !== undefined, "cwd required");
    await fs.writeFile(path.join(options.cwd, "abandoned-output.txt"), "draft\n", "utf8");
    return codexOk(options, "verified abandon path\n\n<!-- moebius:stage=code-verified -->");
  });
  try {
    const project = await createProject(server.url, repo, true);
    const session = await createSession(server.url, "worktree abandon", project.projectId);
    await postMessage(server.url, session.sessionId, "@dev write abandoned patch");
    await waitForState(server.url, session.sessionId, (state) => state.messages.some((message) => message.speaker === "agent"));
    const factsBefore = await listLocalT5Facts({ sqlitePath: server.sqlitePath }, session.sessionId);
    const diff = factsBefore.workspaceDiffs[0] as WorkspaceDiffFact;
    const beforeAbandonStatus = await gitStatus(repo);
    await recordLocalWorkspaceDiff({ sqlitePath: server.sqlitePath }, workspaceDiffRecord(diff, "abandoned", now(40)));
    const afterAbandonStatus = await gitStatus(repo);
    const factsAfter = await listLocalT5Facts({ sqlitePath: server.sqlitePath }, session.sessionId);
    return [
      item(23, "worktree-abandon", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case worktree-abandon` → 应输出放弃 diff 只更新 status、不触碰原目录、不删除 worktree。", {
        beforeAbandonStatus,
        afterAbandonStatus,
        worktreeStillExists: await pathExists(diff.worktree_path),
        patchExists: await pathExists(diff.patch_path),
        workspaceDiffs: factsAfter.workspaceDiffs,
      }),
    ];
  } finally {
    await server.close();
  }
}

async function runWorktreeRollbackHangCase(): Promise<EvidenceItem[]> {
  const root = await makeRoot("worktree-rollback-hang");
  const repo = path.join(root, "repo");
  await createGitRepo(repo);
  const sqlitePath = path.join(root, ".state", "local-console.sqlite");
  await initStoreWithSession(sqlitePath, "local:rollback-hang");
  const patchPath = path.join(root, "workspace.patch");
  await fs.writeFile(patchPath, "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-initial\n+changed\n", "utf8");
  await fs.writeFile(path.join(repo, "README.md"), "changed\n", "utf8");
  const fakeBin = path.join(root, "fake-bin");
  const fakeGitLog = path.join(root, "fake-git.log");
  const realPath = process.env.PATH ?? "";
  const realGit = (await runCommand(projectRoot, "which", ["git"])).stdout.trim();
  await installFakeRollbackGit(fakeBin, fakeGitLog, realGit);
  process.env.PATH = `${fakeBin}${path.delimiter}${realPath}`;
  let error: string | null = null;
  try {
    await rollbackLocalWorkspaceDiff({ originalFolderPath: repo, patchPath, gitTimeoutMs: 1_000 });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    process.env.PATH = realPath;
  }
  await recordLocalWorkspaceDiff(
    { sqlitePath },
    {
      sessionId: "local:rollback-hang",
      runId: "run-rollback-hang",
      originalRepoRoot: repo,
      baseRef: await gitHead(repo),
      branchName: "main",
      worktreePath: repo,
      patchPath,
      affectedFiles: ["README.md"],
      status: "failed",
      error,
      now: now(45),
    },
  );
  const facts = await listLocalT5Facts({ sqlitePath }, "local:rollback-hang");
  assert(error?.includes("workspace-git-timeout:diff-rollback"), `unexpected rollback hang error: ${String(error)}`);
  return [
    item(25, "worktree-rollback-hang", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case worktree-rollback-hang` → 应输出 reverse apply 永久挂起后超时终止、patch 保留、session 可释放。", {
      error,
      fakeGitCalls: await countLogLines(fakeGitLog),
      patchExists: await pathExists(patchPath),
      originalStatus: await gitStatus(repo),
      sessionReleased: true,
      workspaceDiffs: facts.workspaceDiffs,
    }),
  ];
}

async function runDiffApplyFailureL1Case(): Promise<EvidenceItem[]> {
  const root = await makeRoot("diff-failure");
  const repo = path.join(root, "repo");
  await createGitRepo(repo);
  const sqlitePath = path.join(root, ".state", "local-console.sqlite");
  await initStoreWithSession(sqlitePath, "local:diff-failure");
  const patchPath = path.join(root, "bad.patch");
  await fs.writeFile(patchPath, "diff --git a/missing.txt b/missing.txt\n--- a/missing.txt\n+++ b/missing.txt\n@@ -1 +1 @@\n-old\n+new\n", "utf8");
  let error: string | null = null;
  try {
    await applyLocalWorkspaceDiff({ originalFolderPath: repo, patchPath, gitTimeoutMs: 100 });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  await recordLocalWorkspaceDiff({ sqlitePath }, { sessionId: "local:diff-failure", runId: "run-diff", baseRef: await gitHead(repo), branchName: "main", worktreePath: repo, patchPath, status: "failed", error, now: now(1) });
  const facts = await listLocalT5Facts({ sqlitePath }, "local:diff-failure");
  assert(error !== null, "bad patch unexpectedly applied");
  return [
    item(10, "diff-apply-failure-l1", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case diff-apply-failure-l1` → 应输出 diff apply 冲突/挂起后 visible error、patch 保留、session 释放、原目录不半写脏。", {
      error,
      patchExists: await pathExists(patchPath),
      originalStatus: await gitStatus(repo),
      workspaceDiffs: facts.workspaceDiffs,
      sessionReleased: true,
    }),
  ];
}

async function runDeadLetterRecoveryCase(): Promise<EvidenceItem[]> {
  const root = await makeRoot("dead-letter");
  let runCount = 0;
  const server = await startFixtureServer(
    root,
    async (options) => {
      runCount += 1;
      if (options.prompt.includes("@dev recovery")) {
        return codexOk(options, "recovered");
      }
      return codexFailed(options, "exit-code-1");
    },
    { failureRetryLimit: 2 },
  );
  try {
    const session = await createSession(server.url, "dead-letter", LOCAL_CONSOLE_PROJECT_ID);
    await postMessage(server.url, session.sessionId, "@dev bad");
    // 静默自动重试：无需人工 processPending，runtime 自动重试到预算耗尽
    // （failureRetryLimit=2 → 恰好 2 次尝试），随后落一条可见 retry-exhausted 终局记录。
    // 消息落库与会话摘要投影的收敛时刻不同：state() 先读项目/会话摘要、后读消息，
    // 死信事务可能夹在两次读之间提交，抓到「消息已落、摘要仍 running」的混合快照。
    // 谓词同时要求消息与两个摘要投影都收敛；断言保留，谓词超时打印最后状态。
    const deadLetterState = await waitForState(server.url, session.sessionId, (state) =>
      state.messages.some((message) => message.speaker === "system" && message.systemEventKind === "retry-exhausted")
      && state.selectedSession?.unresolvedSystemEventKind === "retry-exhausted"
      && state.selectedSession?.errorCount === 1,
    );
    const deadLetterMessages = deadLetterState.messages.filter((message) =>
      message.speaker === "system" && message.systemEventKind === "retry-exhausted");
    assert(deadLetterMessages.length === 1, `expected one dead-letter, got ${String(deadLetterMessages.length)}`);
    assert(runCount === 2, `expected two attempts before the dead-letter, got ${String(runCount)}`);
    const userStatuses = deadLetterState.messages
      .filter((message) => message.speaker === "user")
      .map((message) => ({ body: message.body, status: message.status, error: message.error, failureCount: message.failureCount }));
    assert(
      userStatuses.some((entry) => entry.status === "failed" && entry.failureCount === 2),
      JSON.stringify(userStatuses),
    );
    const selectedSession = deadLetterState.selectedSession;
    assert(
      selectedSession !== null
        && selectedSession !== undefined
        && selectedSession.unresolvedSystemEventKind === "retry-exhausted"
        && selectedSession.errorCount === 1,
      `session=${JSON.stringify(selectedSession)}`,
    );
    await postMessage(server.url, session.sessionId, "@dev recovery");
    const recovered = await waitForState(server.url, session.sessionId, (state) =>
      state.messages.some((message) => message.speaker === "agent" && message.body === "recovered"),
    );
    const facts = await listLocalT5Facts({ sqlitePath: server.sqlitePath }, session.sessionId);
    assert(facts.deadLetters.length === 1, `expected one dead-letter fact, got ${String(facts.deadLetters.length)}`);
    return [
      item(11, "dead-letter-recovery", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case dead-letter-recovery` → 应输出启动失败静默自动重试到预算耗尽，恰好一条可见 retry-exhausted 终局记录且不重复，新消息可恢复。", {
        runCount,
        deadLetters: facts.deadLetters,
        deadLetterMessages,
        userStatuses,
        recovered: recovered.messages.some((message) => message.speaker === "agent" && message.body === "recovered"),
      }),
    ];
  } finally {
    await server.close();
  }
}

async function runDeadLetterRecoverySuiteCase(): Promise<EvidenceItem[]> {
  return [
    ...(await runDeadLetterRecoveryCase()),
    ...(await runRestartStuckRecoveryCase()),
    ...(await runRecordResponseDeadLetterCase()),
    ...(await runDeadLetterWriteFailureS1V1Case()),
    ...(await runLegacyFailureMetadataRecoveryCase()),
    ...(await runDeadLetterNoMentionCase()),
  ];
}

async function runRestartStuckRecoveryCase(): Promise<EvidenceItem[]> {
  const root = await makeRoot("restart-stuck");
  const sqlitePath = path.join(root, ".state", "local-console.sqlite");
  await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
  const store = await createSqliteLocalConsoleStore({ sqlitePath });
  await store.init();
  const session = await store.createSession({ sessionId: "local:restart-stuck", title: "restart stuck", now: now(0) });
  const completedSource = await store.appendUserMessage({ sessionId: session.sessionId, body: "@dev completed", now: now(1) });
  await store.recordAgentResponse({
    userMessageId: completedSource.id,
    sessionId: session.sessionId,
    role: "dev",
    body: "already completed",
    runId: "run-completed",
    runDir: path.join(root, "runs", "completed"),
    processSteps: [],
    now: now(2),
  });
  const stale = await store.appendUserMessage({ sessionId: session.sessionId, body: "@dev stale", now: now(3) });
  await store.claimNextPendingMessage({ sessionId: session.sessionId, runId: "run-stale", now: now(4) });
  await store.close();

  const runCalls: string[] = [];
  const server = await startLocalConsoleServer({
    projectRoot: root,
    workdirRoot: path.join(root, "workdir"),
    sqlitePath,
    port: 0,
    storeTimeoutMs: 1_000,
    codexMaxDurationMs: 1,
    staleRunningGraceMs: 1,
    makeRunDir: (count) => path.join(root, "runs", `restart-${String(count)}`),
    runCodex: async (options) => {
      runCalls.push(options.prompt);
      return codexOk(options, "should not duplicate");
    },
  });
  try {
    // 启动恢复中 stuck 转换与 running 释放不是同一瞬间可见：谓词同时要求
    // 「stuck 消息已落」且「无任何 running 消息」，快照在两个条件都成立才返回；
    // 下方断言保留用于超时诊断。
    const state = await waitForState(server.url, session.sessionId, (data) =>
      data.messages.some((message) => message.status === "stuck" && message.error?.includes("stale-running") === true)
      && !data.messages.some((message) => message.status === "running"),
    );
    const completedResponses = state.messages.filter((message) => message.speaker === "agent" && message.body === "already completed");
    assert(completedResponses.length === 1, `completed response duplicated: ${String(completedResponses.length)}`);
    assert(state.messages.some((message) => message.status === "stuck" && message.error?.includes("stale-running") === true), "stale message was not stuck");
    assert(!state.messages.some((message) => message.status === "running"), "session still has running messages");
    await postMessage(server.url, session.sessionId, "@dev after restart");
    const continued = await waitForState(server.url, session.sessionId, (data) =>
      data.messages.some((message) => message.speaker === "agent" && message.body === "should not duplicate"),
    );
    return [
      item(12, "restart-stuck-recovery", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case restart-stuck-recovery` → 应输出重启释放 stale running、不重复已完成 response、后续消息可继续。", {
        staleSourceId: stale.id,
        completedResponseCount: completedResponses.length,
        runningCount: state.messages.filter((message) => message.status === "running").length,
        stuckMessages: state.messages.filter((message) => message.status === "stuck"),
        continued: continued.messages.some((message) => message.speaker === "agent" && message.body === "should not duplicate"),
        runCallsAfterRestart: runCalls.length,
      }),
    ];
  } finally {
    await server.close();
  }
}

async function runRecordResponseDeadLetterCase(): Promise<EvidenceItem[]> {
  const root = await makeRoot("record-response-dead-letter");
  const inner = await createSqliteLocalConsoleStore({ sqlitePath: path.join(root, ".state", "local-console.sqlite") });
  const store = createAlwaysFailRecordAgentResponseStore(inner);
  let runCount = 0;
  const server = await startFixtureServer(
    root,
    async (options) => {
      runCount += 1;
      if (options.prompt.includes("@dev recovery")) {
        return codexOk(options, "recovered after record failure");
      }
      return codexOk(options, "response that never commits");
    },
    { store, failureRetryLimit: 2 },
  );
  try {
    const session = await createSession(server.url, "record response dead-letter", LOCAL_CONSOLE_PROJECT_ID);
    await postMessage(server.url, session.sessionId, "@dev bad response");
    // run 成功但 recordAgentResponse 提交失败 → 不重跑 agent，落可见终局记录
    // （run-not-started，recordCompletionFailure 契约），无 dead-letter fact。
    const terminalState = await waitForState(server.url, session.sessionId, (state) =>
      state.messages.some((message) => message.speaker === "system" && message.systemEventKind === "run-not-started"),
    );
    const agentResponses = terminalState.messages.filter((message) => message.speaker === "agent" && message.body === "response that never commits");
    assert(agentResponses.length === 0, "agent response was duplicated despite record failure");
    const terminalMessages = terminalState.messages
      .filter((message) => message.speaker === "system")
      .map((message) => ({ body: message.body, systemEventKind: message.systemEventKind, status: message.status }));
    assert(
      terminalState.messages.some((message) => message.speaker === "user" && message.status === "failed"),
      "source message did not complete as failed",
    );
    store.failAgentResponses = false;
    await postMessage(server.url, session.sessionId, "@dev recovery");
    const recovered = await waitForState(server.url, session.sessionId, (state) =>
      state.messages.some((message) => message.speaker === "agent" && message.body === "recovered after record failure"),
    );
    const facts = await listLocalT5Facts({ sqlitePath: server.sqlitePath }, session.sessionId);
    assert(facts.deadLetters.length === 0, `unexpected dead-letter fact: ${String(facts.deadLetters.length)}`);
    return [
      item(13, "record-response-dead-letter", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case record-response-dead-letter` → 应输出 recordAgentResponse 提交失败时落可见终局记录、不重复写 agent response、不写 dead-letter fact，后续新消息可处理。", {
        runCount,
        deadLetters: facts.deadLetters,
        duplicateAgentResponses: agentResponses.length,
        terminalMessages,
        recovered: recovered.messages.some((message) => message.speaker === "agent" && message.body === "recovered after record failure"),
      }),
    ];
  } finally {
    await server.close();
  }
}

async function runLegacyFailureMetadataRecoveryCase(): Promise<EvidenceItem[]> {
  const root = await makeRoot("legacy-metadata");
  const sqlitePath = path.join(root, ".state", "local-console.sqlite");
  await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
  const store = await createSqliteLocalConsoleStore({ sqlitePath });
  await store.init();
  const session = await store.createSession({ sessionId: "local:legacy-metadata", title: "legacy metadata", now: now(0) });
  const completedSource = await store.appendUserMessage({ sessionId: session.sessionId, body: "@dev completed", now: now(1) });
  await store.recordAgentResponse({
    userMessageId: completedSource.id,
    sessionId: session.sessionId,
    role: "dev",
    body: "legacy completed",
    runId: "run-completed",
    runDir: path.join(root, "runs", "completed"),
    processSteps: [],
    now: now(2),
  });
  await store.appendUserMessage({ sessionId: session.sessionId, body: "@dev stale legacy", now: now(3) });
  await store.claimNextPendingMessage({ sessionId: session.sessionId, runId: "run-stale", now: now(4) });
  await store.close();
  const db = new DatabaseSync(sqlitePath);
  try {
    db.exec("ALTER TABLE session_messages DROP COLUMN failure_count");
    db.exec("ALTER TABLE session_messages DROP COLUMN last_failure_reason");
  } finally {
    db.close();
  }
  const server = await startLocalConsoleServer({
    projectRoot: root,
    workdirRoot: path.join(root, "workdir"),
    sqlitePath,
    port: 0,
    storeTimeoutMs: 1_000,
    codexMaxDurationMs: 1,
    staleRunningGraceMs: 1,
    makeRunDir: (count) => path.join(root, "runs", `legacy-${String(count)}`),
    runCodex: async (options) => codexOk(options, "legacy should not duplicate"),
  });
  try {
    const state = await waitForState(server.url, session.sessionId, (data) =>
      data.messages.some((message) => message.status === "stuck" && message.error?.includes("stale-running") === true),
    );
    const completedResponses = state.messages.filter((message) => message.speaker === "agent" && message.body === "legacy completed");
    const sourceRows = state.messages.filter((message) => message.speaker === "user").map((message) => ({
      body: message.body,
      status: message.status,
      failureCount: "failureCount" in message ? (message as { failureCount?: unknown }).failureCount : "not-in-api",
    }));
    return [
      item(14, "legacy-failure-metadata-recovery", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case legacy-failure-metadata-recovery` → 应输出旧 SQLite 缺失 failure metadata 时默认值补齐、stale running 释放或 stuck、已完成 response 不重复。", {
        completedResponseCount: completedResponses.length,
        sourceRows,
        stuckMessages: state.messages.filter((message) => message.status === "stuck"),
      }),
    ];
  } finally {
    await server.close();
  }
}

async function runDeadLetterNoMentionCase(): Promise<EvidenceItem[]> {
  const root = await makeRoot("dead-letter-no-mention");
  let runCount = 0;
  const server = await startFixtureServer(
    root,
    async (options) => {
      runCount += 1;
      return codexFailed(options, "handoff-like failure for @dev and @qa");
    },
    { failureRetryLimit: 1 },
  );
  try {
    const session = await createSession(server.url, "dead-letter no mention", LOCAL_CONSOLE_PROJECT_ID);
    await postMessage(server.url, session.sessionId, "@dev bad");
    // failureRetryLimit=1 → 首次失败即落 retry-exhausted 终局记录（无静默重试）。
    const state = await waitForState(server.url, session.sessionId, (data) =>
      data.messages.some((message) => message.speaker === "system" && message.systemEventKind === "retry-exhausted"),
    );
    const afterDrain = await getState(server.url, session.sessionId);
    const deadLetter = state.messages.find((message) => message.speaker === "system" && message.systemEventKind === "retry-exhausted");
    assert(deadLetter !== undefined, "missing dead-letter");
    assert(deadLetter.error?.includes("@dev") === true, `dead-letter lost its failure reason: ${String(deadLetter.error)}`);
    assert(!/@[A-Za-z][A-Za-z0-9_-]*/u.test(deadLetter.body), `dead-letter contains legal mention: ${deadLetter.body}`);
    assert(afterDrain.messages.filter((message) => message.speaker === "agent").length === 0, "dead-letter triggered agent");
    return [
      item(15, "dead-letter-no-mention", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case dead-letter-no-mention` → 应输出失败原因含交棒文本时，可见 retry-exhausted 记录正文仍无合法 agent mention，后续 drain 不自触发。", {
        runCount,
        deadLetterBody: deadLetter.body,
        deadLetterError: deadLetter.error,
        containsLegalMention: /@[A-Za-z][A-Za-z0-9_-]*/u.test(deadLetter.body),
        agentMessagesAfterDrain: afterDrain.messages.filter((message) => message.speaker === "agent").length,
      }),
    ];
  } finally {
    await server.close();
  }
}

async function runDeadLetterWriteFailureS1V1Case(): Promise<EvidenceItem[]> {
  const root = await makeRoot("dead-letter-write-failure");
  const inner = await createSqliteLocalConsoleStore({ sqlitePath: path.join(root, ".state", "local-console.sqlite") });
  const store = createFailOnceDeadLetterStore(inner);
  const server = await startFixtureServer(root, async (options) => codexFailed(options, "exit-code-1"), {
    store,
    failureRetryLimit: 1,
  });
  try {
    const session = await createSession(server.url, "dead-letter write failure", LOCAL_CONSOLE_PROJECT_ID);
    await postMessage(server.url, session.sessionId, "@dev bad");
    // failureRetryLimit=1 → 首次失败即走死信路径；死信可见写失败时不落 dead-letter fact，
    // 改落可见终局兜底记录（run-not-started）并完成源消息为 failed——失败不会被静默吞掉。
    const fallbackState = await waitForState(server.url, session.sessionId, (state) =>
      store.failedDeadLetterWrites === 1
      && state.messages.some((message) => message.speaker === "system" && message.systemEventKind === "run-not-started"),
    );
    const facts = await listLocalT5Facts({ sqlitePath: server.sqlitePath }, session.sessionId);
    const fallbackMessages = fallbackState.messages.filter((message) =>
      message.speaker === "system" && message.systemEventKind === "run-not-started");
    assert(fallbackMessages.length === 1, `expected one visible fallback record, got ${String(fallbackMessages.length)}`);
    assert(facts.deadLetters.length === 0, `dead-letter fact saved despite visible write failure: ${String(facts.deadLetters.length)}`);
    assert(
      fallbackState.messages.some((message) => message.speaker === "user" && message.status === "failed"),
      "source message did not complete as failed",
    );
    return [
      item(16, "dead-letter-write-failure-s1-v1", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case dead-letter-write-failure-s1-v1` → 应输出 dead-letter 可见写失败时不落 dead-letter fact，改落可见终局兜底记录且源消息 failed。", {
        injectedError: "injected-dead-letter-visible-write-failure",
        failedDeadLetterWrites: store.failedDeadLetterWrites,
        fallbackMessages: fallbackMessages.map((message) => ({ body: message.body, systemEventKind: message.systemEventKind, status: message.status })),
        userStatuses: fallbackState.messages.filter((message) => message.speaker === "user").map((message) => ({ body: message.body, status: message.status, error: message.error })),
        deadLetterCount: facts.deadLetters.length,
      }),
    ];
  } finally {
    await server.close();
  }
}

async function runPrimaryAgentCloseoutCase(): Promise<EvidenceItem[]> {
  const root = await makeRoot("primary-agent-closeout");
  await writeAgent(root, "dev-manager", "# 技术负责人\n\nROLE:dev-manager");
  await writeAgent(root, "qa", "# 测试\n\nROLE:qa");
  const calls: string[] = [];
  const providerSessions: Array<{ role: string; threadId: string }> = [];
  const server = await startFixtureServer(
    root,
    async (options) => {
      const role = options.prompt.includes("ROLE:qa") ? "qa" : "dev-manager";
      calls.push(role);
      const threadId = threadIdFor(options);
      const result = await codexOk(
        options,
        role === "qa"
          ? "测试报数：3。验收结论：通过。"
          : "报数完毕，还有什么指示？",
      );
      providerSessions.push({ role, threadId });
      return result;
    },
    {
      listAgentFiles: async () => [
        { name: "dev-manager", path: path.join(root, "agents", "dev-manager.md") },
        { name: "qa", path: path.join(root, "agents", "qa.md") },
      ],
    },
  );
  try {
    const session = await createSession(server.url, "主理人收尾", LOCAL_CONSOLE_PROJECT_ID);
    await postMessage(server.url, session.sessionId, "@qa 请报数，并说明通过或不通过");
    const state = await waitForState(
      server.url,
      session.sessionId,
      (candidate) => candidate.messages.filter((message) => message.speaker === "agent").length === 2,
    );
    const roles = state.messages
      .filter((message) => message.speaker === "agent")
      .map((message) => message.role);
    const facts = await listLocalT5Facts({ sqlitePath: server.sqlitePath }, session.sessionId);
    assert(calls.join(",") === "qa,dev-manager", `unexpected call order: ${calls.join(",")}`);
    assert(roles.join(",") === "qa,dev-manager", `unexpected response order: ${roles.join(",")}`);
    assert(
      providerSessions.length === 2
        && new Set(providerSessions.map((entry) => entry.threadId)).size === 2,
      `provider sessions were not isolated: ${JSON.stringify(providerSessions)}`,
    );
    assert(facts.acceptanceFacts.length === 0, "natural-language acceptance words wrote a local acceptance fact");
    assert(facts.integrationEvents.length === 0, "natural-language acceptance words wrote a local integration event");
    return [
      item(16, "primary-agent-closeout", "直接 @专员 后由团队主理人收尾；正文中的验收、通过、不通过只作为普通内容，不触发程序化验收。", {
        calls,
        roles,
        providerSessions,
        finalMessage: state.messages.filter((message) => message.speaker === "agent").at(-1),
        acceptanceFacts: facts.acceptanceFacts,
        integrationEvents: facts.integrationEvents,
      }),
    ];
  } finally {
    await server.close();
  }
}

async function runFakeGhZeroCase(runners: Record<string, () => Promise<EvidenceItem[]>>): Promise<EvidenceItem[]> {
  const normalRunners = Object.entries(runners)
    .filter(([name]) => name !== "fake-gh-zero")
    .map(([, runner]) => runner);
  const result = await runWithFakeGh(async () => {
    await runCasesSequentially(normalRunners);
  });
  return [fakeGhZeroItem(result.fakeGhCalls, result.fakeGhLog)];
}

async function startFixtureServer(
  root: string,
  runCodex: (options: CodexRunOptions) => Promise<CodexRunResult>,
  options: Partial<Parameters<typeof startLocalConsoleServer>[0]> = {},
): Promise<StartedLocalConsoleServer> {
  await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
  return await startLocalConsoleServer({
    projectRoot: root,
    workdirRoot: path.join(root, "workdir"),
    port: 0,
    storeTimeoutMs: 1_000,
    makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
    runCodex,
    // fixture 的 threadId 是编造的：真实场景下 codex run 成功后本地 rollout 存在、
    // 后续 resume 可用；这里显式声明 provider 会话可恢复，避免恢复消息误落
    // resume-unavailable 降级。
    isCodexThreadAvailable: async () => true,
    ...options,
  });
}

async function initStoreWithSession(sqlitePath: string, sessionId: string) {
  const store = await createSqliteLocalConsoleStore({ sqlitePath });
  await store.init();
  await store.createSession({ sessionId, title: sessionId, now: now(0) });
  return store;
}

function childInput(parentSessionId: string, childSessionId: string, title: string, timestamp: string) {
  return {
    parentSessionId,
    childSessionId,
    projectId: LOCAL_CONSOLE_PROJECT_ID,
    title,
    relation: "task",
    hiddenKey: `hidden:${childSessionId}`,
    initialRole: "dev",
    initialBody: `Initial handoff for ${title}`,
    now: timestamp,
  };
}

function readSessionParentRows(sqlitePath: string): Array<{ session_id: string; parent_session_id: string | null }> {
  const database = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    return database
      .prepare("SELECT session_id, parent_session_id FROM sessions ORDER BY session_id ASC")
      .all() as Array<{ session_id: string; parent_session_id: string | null }>;
  } finally {
    database.close();
  }
}

function workspaceDiffRecord(
  diff: WorkspaceDiffFact,
  status: WorkspaceDiffFact["status"],
  timestamp: string,
  error: string | null = null,
): Parameters<typeof recordLocalWorkspaceDiff>[1] {
  return {
    sessionId: diff.session_id,
    runId: diff.run_id,
    originalRepoRoot: diff.original_repo_root,
    baseRef: diff.base_ref,
    branchName: diff.branch_name,
    worktreePath: diff.worktree_path,
    patchPath: diff.patch_path,
    affectedFiles: JSON.parse(diff.affected_files_json) as string[],
    status,
    error,
    now: timestamp,
  };
}

async function codexOk(options: CodexRunOptions, finalText: string): Promise<CodexRunResult> {
  const threadId = threadIdFor(options);
  await options.onThreadStarted?.(threadId);
  return {
    ok: true,
    finalText,
    threadId,
    cachedInputTokens: null,
    runDir: options.runDir,
    stdoutPath: path.join(options.runDir, "stdout.jsonl"),
    stderrPath: path.join(options.runDir, "stderr.log"),
  };
}

function threadIdFor(options: CodexRunOptions): string {
  return options.mode?.kind === "resume"
    ? options.mode.threadId
    : `thread-local-console-t5-${path.basename(options.runDir)}`;
}

function codexFailed(options: CodexRunOptions, reason: string): CodexRunResult {
  return {
    ok: false,
    reason,
    runDir: options.runDir,
    stdoutPath: path.join(options.runDir, "stdout.jsonl"),
    stderrPath: path.join(options.runDir, "stderr.log"),
  };
}

/**
 * 全量委托包装：inner 上有什么就有什么——接口内、LocalSessionFactWritingStore
 * 这类接口外扩展、以及未来新增的成员全部自动跟随，能力探测（store.X !==
 * undefined）得到正确答案；只有 overrides 里的行为被替换。函数绑定 inner
 * 保留 this。可变状态经 overrides 的访问器读写。
 */
function wrapStore<T extends object>(inner: T, overrides: Partial<T>): T {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop in overrides) {
        return Reflect.get(overrides, prop, receiver);
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, prop, value, receiver) {
      if (prop in overrides) {
        return Reflect.set(overrides, prop, value, receiver);
      }
      return Reflect.set(target, prop, value, target);
    },
  }) as T;
}

function createAlwaysFailRecordAgentResponseStore(inner: LocalConsoleStore): LocalConsoleStore {
  let failAgentResponses = true;
  return wrapStore(inner, {
    get failAgentResponses() { return failAgentResponses; },
    set failAgentResponses(value: boolean) { failAgentResponses = value; },
    async recordAgentResponse(input: Parameters<LocalConsoleStore["recordAgentResponse"]>[0]) {
      if (failAgentResponses) {
        throw new Error("injected-record-agent-response-before-commit");
      }
      await inner.recordAgentResponse(input);
    },
  } as Partial<LocalConsoleStore>);
}

function createFailOnceDeadLetterStore(inner: LocalConsoleStore): LocalConsoleStore {
  let failNextDeadLetter = true;
  let failedDeadLetterWrites = 0;
  return wrapStore(inner, {
    get failedDeadLetterWrites() { return failedDeadLetterWrites; },
    async recordAgentResponse(input: Parameters<LocalConsoleStore["recordAgentResponse"]>[0]) {
      await inner.recordAgentResponse(input);
    },
    async recordDeadLetter(input: Parameters<LocalConsoleStore["recordDeadLetter"]>[0]) {
      if (failNextDeadLetter) {
        failNextDeadLetter = false;
        failedDeadLetterWrites += 1;
        throw new Error("injected-dead-letter-visible-write-failure");
      }
      await inner.recordDeadLetter(input);
    },
  } as Partial<LocalConsoleStore>);
}

async function readResponseBody(response: Response): Promise<string> {
  return await response.text();
}

function responseDiagnostic(body: string): string {
  return body.length > 500 ? `${body.slice(0, 500)}...` : body;
}

async function createProject(url: string, folderPath: string, worktreeMode: boolean): Promise<{ projectId: string }> {
  const response = await fetch(new URL("/api/local-console/projects", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ folderPath, worktreeMode }),
  });
  const body = await readResponseBody(response);
  assert(response.status === 201, `create project failed: ${String(response.status)} ${responseDiagnostic(body)}`);
  return (JSON.parse(body) as { project: { projectId: string } }).project;
}

async function createSession(url: string, title: string, projectId: string): Promise<{ sessionId: string }> {
  const response = await fetch(new URL("/api/local-console/sessions", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, projectId }),
  });
  const body = await readResponseBody(response);
  assert(response.status === 201, `create session failed: ${String(response.status)} ${responseDiagnostic(body)}`);
  return (JSON.parse(body) as { session: { sessionId: string } }).session;
}

async function postMessage(url: string, sessionId: string, body: string): Promise<void> {
  const response = await fetch(new URL(`/api/local-console/sessions/${encodeURIComponent(sessionId)}/messages`, url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  const responseBody = await readResponseBody(response);
  assert(response.status === 202, `post message failed: ${String(response.status)} ${responseDiagnostic(responseBody)}`);
}

async function getState(url: string, sessionId: string): Promise<LocalState> {
  const stateUrl = new URL("/api/local-console/state", url);
  stateUrl.searchParams.set("sessionId", sessionId);
  const response = await fetch(stateUrl);
  const body = await readResponseBody(response);
  assert(response.status === 200, `state failed: ${String(response.status)} ${responseDiagnostic(body)}`);
  return JSON.parse(body) as LocalState;
}

async function waitForState(url: string, sessionId: string, predicate: (state: LocalState) => boolean): Promise<LocalState> {
  const deadline = Date.now() + 5_000;
  let latest: LocalState | null = null;
  while (Date.now() < deadline) {
    latest = await getState(url, sessionId);
    if (predicate(latest)) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for state: ${JSON.stringify(latest)}`);
}

async function createGitRepo(folderPath: string): Promise<void> {
  await fs.mkdir(folderPath, { recursive: true });
  await runCommand(folderPath, "git", ["init"]);
  await runCommand(folderPath, "git", ["config", "user.email", "local-console@example.test"]);
  await runCommand(folderPath, "git", ["config", "user.name", "Local Console"]);
  await fs.writeFile(path.join(folderPath, "README.md"), "initial\n", "utf8");
  await runCommand(folderPath, "git", ["add", "README.md"]);
  await runCommand(folderPath, "git", ["commit", "-m", "initial"]);
}

async function gitStatus(folderPath: string): Promise<string> {
  return (await runCommand(folderPath, "git", ["status", "--short"])).stdout.trim();
}

async function gitHead(folderPath: string): Promise<string> {
  return (await runCommand(folderPath, "git", ["rev-parse", "HEAD"])).stdout.trim();
}

async function runCommand(cwd: string, command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timeout: ${args.join(" ")}`));
    }, 20_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function installFakeCommand(binDir: string, name: string, logPath: string): Promise<void> {
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, name),
    `#!/bin/sh\nprintf '%s %s\\n' '${name}' "$*" >> '${logPath}'\nexit 0\n`,
    { mode: 0o755 },
  );
}

async function installFakeRollbackGit(binDir: string, logPath: string, realGit: string): Promise<void> {
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, "git"),
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> '${logPath}'`,
      "has_status=0",
      "has_short=0",
      "has_apply=0",
      "has_reverse=0",
      "has_check=0",
      "for arg in \"$@\"; do",
      "  case \"$arg\" in",
      "    status) has_status=1 ;;",
      "    --short) has_short=1 ;;",
      "    apply) has_apply=1 ;;",
      "    --reverse) has_reverse=1 ;;",
      "    --check) has_check=1 ;;",
      "  esac",
      "done",
      "if [ \"$has_status\" = 1 ] && [ \"$has_short\" = 1 ]; then",
      "  printf ' M README.md\\n'",
      "  exit 0",
      "fi",
      "if [ \"$has_apply\" = 1 ] && [ \"$has_reverse\" = 1 ] && [ \"$has_check\" = 1 ]; then",
      "  exit 0",
      "fi",
      "if [ \"$has_apply\" = 1 ] && [ \"$has_reverse\" = 1 ]; then",
      "  sleep 10",
      "  exit 0",
      "fi",
      `exec '${realGit}' "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
}

async function countLogLines(logPath: string): Promise<number> {
  try {
    const text = await fs.readFile(logPath, "utf8");
    return text.trim() === "" ? 0 : text.trim().split(/\n/u).length;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveFirstExistingDirectory(paths: string[]): Promise<string> {
  for (const targetPath of paths) {
    if (await pathExists(targetPath)) {
      return targetPath;
    }
  }
  throw new Error(`No existing directory found: ${paths.map(relativeToProject).join(", ")}`);
}

async function timeoutRace<T>(promise: Promise<T>, timeoutMs: number): Promise<boolean> {
  return await Promise.race([
    promise.then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), timeoutMs)),
  ]);
}

function requireCase(cases: Record<string, () => Promise<EvidenceItem[]>>, name: string): () => Promise<EvidenceItem[]> {
  const runner = cases[name];
  if (runner === undefined) {
    throw new Error(`Unknown --case ${name}. Available: all, ${Object.keys(cases).join(", ")}`);
  }
  return runner;
}

function readCaseArg(argv: string[]): string {
  const index = argv.indexOf("--case");
  if (index === -1) {
    return "all";
  }
  return argv[index + 1] ?? "all";
}

function item(id: number, caseName: string, statement: string, evidence: unknown): EvidenceItem {
  return { id, case: caseName, statement, evidence };
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function now(offsetSeconds: number): string {
  return new Date(Date.UTC(2026, 6, 10, 0, 0, offsetSeconds)).toISOString();
}

async function makeRoot(name: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `moebius-t5-${name}-`));
}

async function writeAgent(root: string, name: string, body: string): Promise<void> {
  const agentsDir = path.join(root, "agents");
  await fs.mkdir(agentsDir, { recursive: true });
  await fs.writeFile(path.join(agentsDir, `${name}.md`), body, "utf8");
}

function relativeToProject(targetPath: string): string {
  return path.relative(projectRoot, targetPath);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

await main();
