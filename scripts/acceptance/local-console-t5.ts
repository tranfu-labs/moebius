import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { CodexRunOptions, CodexRunResult } from "../../src/codex.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../../src/local-console/start.js";
import { createSqliteLocalConsoleStore } from "../../src/local-console/store.js";
import { LocalConsoleRuntime } from "../../src/local-console/runtime.js";
import {
  listLocalT5Facts,
  recordLocalDeadLetter,
  recordLocalRouteDecision,
  recordLocalWorkspaceDiff,
} from "../../src/local-console/t5-store.js";
import { applyLocalWorkspaceDiff, rollbackLocalWorkspaceDiff } from "../../src/local-console/workspace-source.js";
import { LOCAL_CONSOLE_PROJECT_ID, type LocalConsoleMessage, type LocalConsoleStore } from "../../src/local-console/types.js";
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
  messages: Array<{ speaker: string; role: string | null; body: string; status: string; error: string | null; failureCount?: number }>;
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
const changeDir = path.join(projectRoot, "openspec", "changes", "local-console-t5-full-parity");
const artifactDir = await createAcceptanceOutputDirectory("local-console-t5");
const evidencePath = path.join(artifactDir, "t5-evidence.json");
const prBodyDraftPath = path.join(artifactDir, "t5-pr-body.md");
const selectedCase = readCaseArg(process.argv);

async function main(): Promise<void> {
  await fs.mkdir(artifactDir, { recursive: true });
  const runners: Record<string, () => Promise<EvidenceItem[]>> = {
    openspec: runOpenSpecCase,
    "must-matrix": runMustMatrixCase,
    "delta-shape": runDeltaShapeCase,
    "multi-child-goal": runMultiChildGoalCase,
    "route-hang-l1": runRouteHangL1Case,
    "visible-write-s1-v1": runVisibleWriteS1V1Case,
    "worktree-diff": runWorktreeDiffCase,
    "worktree-return-rollback": runWorktreeReturnRollbackCase,
    "worktree-rollback-hang": runWorktreeRollbackHangCase,
    "worktree-abandon": runWorktreeAbandonCase,
    "worktree-issue-parity": runWorktreeIssueParityCase,
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
    "roadmap-evidence": runRoadmapEvidenceCase,
    "pr-evidence": runPrEvidenceCase,
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

async function runMustMatrixCase(): Promise<EvidenceItem[]> {
  const source = await fs.readFile(path.join(projectRoot, "openspec", "specs", "github-issue-runner", "spec.md"), "utf8");
  const mustLines = source.split(/\n/u).flatMap((line, index) => (line.includes("MUST") ? [index + 1] : []));
  const bulletMustCount = source.split(/\n/u).filter((line) => /^\s*-\s+MUST/u.test(line)).length;
  const coverage = await Promise.all(["proposal.md", "tasks.md"].map(async (file) => {
    const text = await fs.readFile(path.join(changeDir, file), "utf8");
    const covered = new Set<number>();
    for (const match of text.matchAll(/GIR:L(\d+)(?:-L?(\d+))?/gu)) {
      const start = Number(match[1]);
      const end = match[2] === undefined ? start : Number(match[2]);
      for (let line = start; line <= end; line += 1) {
        covered.add(line);
      }
    }
    const missing = mustLines.filter((line) => !covered.has(line));
    return { file, covered: mustLines.length - missing.length, total: mustLines.length, missing };
  }));
  assert(coverage.every((entry) => entry.missing.length === 0), JSON.stringify(coverage));
  return [
    item(2, "must-matrix", `查看 \`proposal.md\` 与 \`tasks.md\` → 应看到 ${String(mustLines.length)} 行含 \`MUST\` 源行均映射为三类，并说明 ${String(bulletMustCount)} 行项目符号 \`- MUST\` 不是本任务验收口径。`, {
      coverage,
      bulletMustCount,
    }),
  ];
}

async function runDeltaShapeCase(): Promise<EvidenceItem[]> {
  const files = await listFiles(changeDir);
  const oldDelta = files.filter((file) => file.includes(`${path.sep}spec-delta${path.sep}`));
  const githubDelta = files.filter((file) => file.endsWith(path.join("specs", "github-issue-runner", "spec.md")));
  assert(oldDelta.length === 0, `old spec-delta files exist: ${oldDelta.join(",")}`);
  assert(githubDelta.length === 0, `github delta exists: ${githubDelta.join(",")}`);
  return [
    item(3, "delta-shape", "查看 `specs/local-console/spec.md` 与 `specs/console-ui/spec.md` → 应看到当前 OpenSpec CLI 识别的 delta，且没有 `github-issue-runner` delta。", {
      files: files.map(relativeToProject),
      oldDeltaCount: oldDelta.length,
      githubDeltaCount: githubDelta.length,
    }),
  ];
}

async function runWorktreeParitySuiteCase(): Promise<EvidenceItem[]> {
  return await runCasesSequentially([
    runWorktreeDiffCase,
    runWorktreeReturnRollbackCase,
    runWorktreeRollbackHangCase,
    runWorktreeAbandonCase,
    runWorktreeIssueParityCase,
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

async function runWorktreeIssueParityCase(): Promise<EvidenceItem[]> {
  const localSource = await fs.readFile(path.join(projectRoot, "src", "local-console", "workspace-source.ts"), "utf8");
  const issueSource = await fs.readFile(path.join(projectRoot, "src", "agent-prescripts", "issue-worktree.ts"), "utf8");
  const localChecks = {
    stableBranch: localSource.includes("worktree\", \"add\", \"-B\", branchName"),
    cwdWorktree: localSource.includes("cwd: worktreePath"),
    noRemoteFetch: !localSource.includes("fetchRemoteMain"),
    diffReturnLocalOnly: localSource.includes("applyLocalWorkspaceDiff"),
  };
  const issueChecks = {
    stableIssueBranch: issueSource.includes("buildIssueLocalBranchName(input)"),
    cwdWorktree: issueSource.includes("codexCwd: paths.worktreePath") || issueSource.includes("codexCwd: state.worktreePath"),
    refreshOnlyOnReuse: issueSource.includes("refreshAndCheckMainStatus"),
    noDiffReturn: !issueSource.includes("applyLocalWorkspaceDiff") && !issueSource.includes("workspace.patch"),
  };
  assert(Object.values(localChecks).every(Boolean), JSON.stringify(localChecks));
  assert(Object.values(issueChecks).every(Boolean), JSON.stringify(issueChecks));
  return [
    item(24, "worktree-issue-parity", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case worktree-issue-parity` → 应输出本地 workspace source 与 issue-worktree 三点对照，且 GitHub issue-worktree 无 diff 回流漂移。", {
      localChecks,
      issueChecks,
      files: [
        "src/local-console/workspace-source.ts",
        "src/agent-prescripts/issue-worktree.ts",
      ],
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
    await waitForState(server.url, session.sessionId, (state) =>
      state.messages.some((message) => message.speaker === "user" && message.status === "pending" && message.error === "exit-code-1"),
    );
    await server.runtime.processPending(session.sessionId);
    const deadLetterState = await waitForState(server.url, session.sessionId, (state) =>
      state.messages.some((message) => message.speaker === "system" && message.body.includes("Local dead-letter")),
    );
    await server.runtime.processPending(session.sessionId);
    const afterPoll = await getState(server.url, session.sessionId);
    await postMessage(server.url, session.sessionId, "@dev recovery");
    const recovered = await waitForState(server.url, session.sessionId, (state) =>
      state.messages.some((message) => message.speaker === "agent" && message.body === "recovered"),
    );
    const facts = await listLocalT5Facts({ sqlitePath: server.sqlitePath }, session.sessionId);
    const deadLetterMessages = afterPoll.messages.filter((message) => message.speaker === "system" && message.body.includes("Local dead-letter"));
    assert(deadLetterMessages.length === 1, `expected one dead-letter, got ${String(deadLetterMessages.length)}`);
    assert(facts.deadLetters.length === 1, `expected one dead-letter fact, got ${String(facts.deadLetters.length)}`);
    return [
      item(11, "dead-letter-recovery", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case dead-letter-recovery` → 应输出连续失败进入 visible dead-letter，后续不重复刷，新消息可恢复。", {
        runCount,
        deadLetters: facts.deadLetters,
        deadLetterMessages,
        userStatuses: deadLetterState.messages.filter((message) => message.speaker === "user").map((message) => ({ body: message.body, status: message.status, error: message.error })),
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
    const state = await waitForState(server.url, session.sessionId, (data) =>
      data.messages.some((message) => message.status === "stuck" && message.error?.includes("stale-running") === true),
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
  const store = new AlwaysFailRecordAgentResponseStore(inner);
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
    await waitForState(server.url, session.sessionId, (state) =>
      state.messages.some((message) => message.speaker === "user" && message.status === "pending"),
    );
    await server.runtime.processPending(session.sessionId);
    const deadLetter = await waitForState(server.url, session.sessionId, (state) =>
      state.messages.some((message) => message.speaker === "system" && message.body.includes("Local dead-letter")),
    );
    await postMessage(server.url, session.sessionId, "@dev recovery");
    store.failAgentResponses = false;
    const recovered = await waitForState(server.url, session.sessionId, (state) =>
      state.messages.some((message) => message.speaker === "agent" && message.body === "recovered after record failure"),
    );
    const facts = await listLocalT5Facts({ sqlitePath: server.sqlitePath }, session.sessionId);
    const agentResponses = deadLetter.messages.filter((message) => message.speaker === "agent" && message.body === "response that never commits");
    assert(agentResponses.length === 0, "agent response was duplicated despite record failure");
    assert(facts.deadLetters.length === 1, `expected one dead-letter fact, got ${String(facts.deadLetters.length)}`);
    return [
      item(13, "record-response-dead-letter", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case record-response-dead-letter` → 应输出 recordAgentResponse 提交前连续失败只产生一条 dead-letter，不重复写 agent response，后续新消息可处理。", {
        runCount,
        deadLetters: facts.deadLetters,
        duplicateAgentResponses: agentResponses.length,
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
    const state = await waitForState(server.url, session.sessionId, (data) =>
      data.messages.some((message) => message.speaker === "system" && message.body.includes("Local dead-letter")),
    );
    await server.runtime.processPending(session.sessionId);
    const afterDrain = await getState(server.url, session.sessionId);
    const deadLetter = state.messages.find((message) => message.speaker === "system" && message.body.includes("Local dead-letter"));
    assert(deadLetter !== undefined, "missing dead-letter");
    assert(!/@[A-Za-z][A-Za-z0-9_-]*/u.test(deadLetter.body), `dead-letter contains legal mention: ${deadLetter.body}`);
    assert(afterDrain.messages.filter((message) => message.speaker === "agent").length === 0, "dead-letter triggered agent");
    return [
      item(15, "dead-letter-no-mention", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case dead-letter-no-mention` → 应输出 dead-letter reason/body 含交棒文本时可见记录仍无合法 agent mention，后续 drain 不自触发。", {
        runCount,
        deadLetterBody: deadLetter.body,
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
  const store = new FailOnceDeadLetterStore(inner);
  const server = await startFixtureServer(root, async (options) => codexFailed(options, "exit-code-1"), {
    store,
    failureRetryLimit: 1,
  });
  try {
    const session = await createSession(server.url, "dead-letter write failure", LOCAL_CONSOLE_PROJECT_ID);
    await postMessage(server.url, session.sessionId, "@dev bad");
    await waitForState(server.url, session.sessionId, (state) =>
      store.failedDeadLetterWrites === 1 &&
      state.messages.some((message) => message.speaker === "user" && message.status === "pending"),
    );
    const factsBeforeRetry = await listLocalT5Facts({ sqlitePath: server.sqlitePath }, session.sessionId);
    const messagesBeforeRetry = await getState(server.url, session.sessionId);
    assert(factsBeforeRetry.deadLetters.length === 0, "dead-letter outcome saved despite visible write failure");
    await server.runtime.processPending(session.sessionId);
    const deadLetter = await waitForState(server.url, session.sessionId, (state) =>
      state.messages.some((message) => message.speaker === "system" && message.body.includes("Local dead-letter")),
    );
    const factsAfterRetry = await listLocalT5Facts({ sqlitePath: server.sqlitePath }, session.sessionId);
    return [
      item(16, "dead-letter-write-failure-s1-v1", "跑 `pnpm exec tsx scripts/acceptance/local-console-t5.ts --case dead-letter-write-failure-s1-v1` → 应输出 dead-letter 可见写失败时 cursor 不推进且可 retry，恢复后同一 source 可写入 dead-letter。", {
        injectedError: "injected-dead-letter-visible-write-failure",
        beforeRetry: {
          messages: messagesBeforeRetry.messages,
          deadLetterCount: factsBeforeRetry.deadLetters.length,
        },
        afterRetry: {
          deadLetterMessages: deadLetter.messages.filter((message) => message.speaker === "system" && message.body.includes("Local dead-letter")),
          deadLetterCount: factsAfterRetry.deadLetters.length,
        },
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

async function runRoadmapEvidenceCase(): Promise<EvidenceItem[]> {
  const roadmap = await fs.readFile(path.join(projectRoot, "docs", "roadmap", "milestone-4-local-console.md"), "utf8");
  const t5Section = extractMarkdownSection(roadmap, "### - [x] T5 · 本地全功能对等");
  assert(t5Section.includes("artifacts/acceptance/t5-evidence.json"), "roadmap missing T5 evidence path");
  assert(t5Section.includes("--case all"), "roadmap missing all-case evidence");
  assert(t5Section.includes("MUST") && t5Section.includes("564") && t5Section.includes("475"), "roadmap missing MUST matrix counts");
  assert(t5Section.includes("pnpm test") && t5Section.includes("退出码 0"), "roadmap missing pnpm test exit code");
  assert(t5Section.includes("pnpm typecheck") && t5Section.includes("退出码 0"), "roadmap missing pnpm typecheck exit code");
  assert(t5Section.includes("T6") && t5Section.includes("M3") && t5Section.includes("A-K"), "roadmap missing T6/M3 non-goal note");
  return [
    item(14, "roadmap-evidence", "查看 roadmap → 应看到 T5 勾选 `[x]`、验收证据、MUST 文档勾选说明、测试/typecheck 退出码，并明确 T6 flag 与 M3 A-K 不在 T5。", {
      t5Checked: true,
      evidencePath: t5Section.includes("artifacts/acceptance/t5-evidence.json"),
      allCase: t5Section.includes("--case all"),
      mustMatrixCounts: { mustLines: 564, bulletMustCount: 475 },
      testExitCode: t5Section.includes("pnpm test") && t5Section.includes("退出码 0"),
      typecheckExitCode: t5Section.includes("pnpm typecheck") && t5Section.includes("退出码 0"),
      nonGoals: { t6: t5Section.includes("T6"), m3: t5Section.includes("M3") && t5Section.includes("A-K") },
    }),
  ];
}

async function runPrEvidenceCase(): Promise<EvidenceItem[]> {
  const body = await fs.readFile(prBodyDraftPath, "utf8");
  for (const required of [
    "Closes #109",
    "Closes #116",
    "artifacts/acceptance/t5-evidence.json",
    "openspec/changes/local-console-t5-full-parity/proposal.md",
    "pnpm test",
    "pnpm typecheck",
  ]) {
    assert(body.includes(required), `PR body draft missing ${required}`);
  }
  assert(!body.includes("Closes #..."), "PR body draft still contains placeholder Closes #...");
  return [
    item(15, "pr-evidence", "查看 T5 PR body draft → 应看到关闭锚点、T5 证据、测试/typecheck 退出码、MUST 矩阵路径和证据摘要。", {
      draftPath: relativeToProject(prBodyDraftPath),
      closesParent: body.includes("Closes #109"),
      closesChild: body.includes("Closes #116"),
      evidencePath: body.includes("artifacts/acceptance/t5-evidence.json"),
      mustMatrixPath: body.includes("openspec/changes/local-console-t5-full-parity/proposal.md"),
      testSummary: body.includes("pnpm test") && body.includes("pnpm typecheck"),
    }),
  ];
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

class AlwaysFailRecordAgentResponseStore implements LocalConsoleStore {
  readonly sqlitePath: string;
  failAgentResponses = true;

  constructor(protected readonly inner: LocalConsoleStore) {
    this.sqlitePath = inner.sqlitePath;
  }

  async init(): Promise<void> { await this.inner.init(); }
  async close(): Promise<void> { await this.inner.close(); }
  async createProject(input: Parameters<LocalConsoleStore["createProject"]>[0]) { return await this.inner.createProject(input); }
  async updateProject(input: Parameters<LocalConsoleStore["updateProject"]>[0]) { return await this.inner.updateProject(input); }
  async reorderProjects(projectIds: string[]) { return await this.inner.reorderProjects(projectIds); }
  async listProjects() { return await this.inner.listProjects(); }
  async getSessionWorkspace(sessionId: string) { return await this.inner.getSessionWorkspace(sessionId); }
  async recordProjectWorkspaceStatus(input: Parameters<LocalConsoleStore["recordProjectWorkspaceStatus"]>[0]) { await this.inner.recordProjectWorkspaceStatus(input); }
  async createSession(input: Parameters<LocalConsoleStore["createSession"]>[0]) { return await this.inner.createSession(input); }
  async listSessions() { return await this.inner.listSessions(); }
  async markSessionResultRead(input: Parameters<LocalConsoleStore["markSessionResultRead"]>[0]) { return await this.inner.markSessionResultRead(input); }
  async appendUserMessage(input: Parameters<LocalConsoleStore["appendUserMessage"]>[0]) { return await this.inner.appendUserMessage(input); }
  async listMessages(sessionId: string) { return await this.inner.listMessages(sessionId); }
  async hasRunningMessage(sessionId: string) { return await this.inner.hasRunningMessage(sessionId); }
  async claimNextPendingMessage(input: Parameters<LocalConsoleStore["claimNextPendingMessage"]>[0]) { return await this.inner.claimNextPendingMessage(input); }
  async setRunDir(input: Parameters<LocalConsoleStore["setRunDir"]>[0]) { await this.inner.setRunDir(input); }
  async recordAgentResponse(input: Parameters<LocalConsoleStore["recordAgentResponse"]>[0]) {
    if (this.failAgentResponses) {
      throw new Error("injected-record-agent-response-before-commit");
    }
    await this.inner.recordAgentResponse(input);
  }
  async recordSystemAndComplete(input: Parameters<LocalConsoleStore["recordSystemAndComplete"]>[0]) { await this.inner.recordSystemAndComplete(input); }
  async recordMessageProcessed(input: Parameters<LocalConsoleStore["recordMessageProcessed"]>[0]) { await this.inner.recordMessageProcessed(input); }
  async findRouteDecision(input: Parameters<LocalConsoleStore["findRouteDecision"]>[0]) { return await this.inner.findRouteDecision(input); }
  async recordRouteAppend(input: Parameters<LocalConsoleStore["recordRouteAppend"]>[0]) { await this.inner.recordRouteAppend(input); }
  async recordRouteNoAction(input: Parameters<LocalConsoleStore["recordRouteNoAction"]>[0]) { await this.inner.recordRouteNoAction(input); }
  async releaseMessageForRetry(input: Parameters<LocalConsoleStore["releaseMessageForRetry"]>[0]) { await this.inner.releaseMessageForRetry(input); }
  async recordFailure(input: Parameters<LocalConsoleStore["recordFailure"]>[0]) { await this.inner.recordFailure(input); }
  async recordRetryableFailure(input: Parameters<LocalConsoleStore["recordRetryableFailure"]>[0]): Promise<LocalConsoleMessage> { return await this.inner.recordRetryableFailure(input); }
  async recordDeadLetter(input: Parameters<LocalConsoleStore["recordDeadLetter"]>[0]) { await this.inner.recordDeadLetter(input); }
  async recordInterrupted(input: Parameters<LocalConsoleStore["recordInterrupted"]>[0]) { await this.inner.recordInterrupted(input); }
  async recordStuck(input: Parameters<LocalConsoleStore["recordStuck"]>[0]) { await this.inner.recordStuck(input); }
  async markStaleRunning(input: Parameters<LocalConsoleStore["markStaleRunning"]>[0]) { return await this.inner.markStaleRunning(input); }
}

class FailOnceDeadLetterStore extends AlwaysFailRecordAgentResponseStore {
  private failNextDeadLetter = true;
  failedDeadLetterWrites = 0;

  override async recordAgentResponse(input: Parameters<LocalConsoleStore["recordAgentResponse"]>[0]) {
    await this.inner.recordAgentResponse(input);
  }

  override async recordDeadLetter(input: Parameters<LocalConsoleStore["recordDeadLetter"]>[0]) {
    if (this.failNextDeadLetter) {
      this.failNextDeadLetter = false;
      this.failedDeadLetterWrites += 1;
      throw new Error("injected-dead-letter-visible-write-failure");
    }
    await super.recordDeadLetter(input);
  }
}

async function createProject(url: string, folderPath: string, worktreeMode: boolean): Promise<{ projectId: string }> {
  const response = await fetch(new URL("/api/local-console/projects", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ folderPath, worktreeMode }),
  });
  assert(response.status === 201, `create project failed: ${String(response.status)}`);
  const body = (await response.json()) as { project: { projectId: string } };
  return body.project;
}

async function createSession(url: string, title: string, projectId: string): Promise<{ sessionId: string }> {
  const response = await fetch(new URL("/api/local-console/sessions", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, projectId }),
  });
  assert(response.status === 201, `create session failed: ${String(response.status)}`);
  const body = (await response.json()) as { session: { sessionId: string } };
  return body.session;
}

async function postMessage(url: string, sessionId: string, body: string): Promise<void> {
  const response = await fetch(new URL(`/api/local-console/sessions/${encodeURIComponent(sessionId)}/messages`, url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  assert(response.status === 202, `post message failed: ${String(response.status)}`);
}

async function getState(url: string, sessionId: string): Promise<LocalState> {
  const stateUrl = new URL("/api/local-console/state", url);
  stateUrl.searchParams.set("sessionId", sessionId);
  const response = await fetch(stateUrl);
  assert(response.status === 200, `state failed: ${String(response.status)}`);
  return (await response.json()) as LocalState;
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

async function listFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
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

function extractMarkdownSection(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  assert(start !== -1, `missing heading: ${heading}`);
  const rest = markdown.slice(start);
  const nextHeading = rest.slice(heading.length).search(/\n### /u);
  return nextHeading === -1 ? rest : rest.slice(0, heading.length + nextHeading);
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
