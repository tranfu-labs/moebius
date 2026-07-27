import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { CodexRunOptions, CodexRunResult } from "../../src/codex.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../../src/local-console/server.js";
import { createSqliteLocalConsoleStore } from "../../src/local-console/store.js";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

interface Evidence {
  acceptance: Array<{ id: number; statement: string; evidence: unknown }>;
  artifacts: { evidence: string };
}

interface RunCall {
  cwd: string;
  runDir: string;
  fileName: string;
}

interface LocalState {
  projects: Array<{
    projectId: string;
    title: string;
    folderPath: string;
    worktreeMode: boolean;
    worktreeUnavailableReason: string | null;
    sessions: Array<{ sessionId: string; projectId: string; title: string }>;
  }>;
  project: {
    projectId: string;
    title: string;
    folderPath: string;
    worktreeMode: boolean;
    worktreeUnavailableReason: string | null;
  };
  messages: Array<{ speaker: string; role: string | null; body: string; status: string; error: string | null; runDir: string | null }>;
  activeRun: { cwd: string | null; runDir: string | null; worktreeUnavailableReason: string | null } | null;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const artifactDir = await createAcceptanceOutputDirectory("local-console-t46");
const evidencePath = path.join(artifactDir, "t46-evidence.json");

async function main(): Promise<void> {
  await fs.mkdir(artifactDir, { recursive: true });
  const originalPath = process.env.PATH ?? "";
  const acceptance: Evidence["acceptance"] = [];

  const mainRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-t46-main-"));
  const fakeGhLog = path.join(mainRoot, "fake-gh.log");
  const fakeBin = path.join(mainRoot, "fake-bin");
  await installFakeCommand(fakeBin, "gh", fakeGhLog);
  process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
  const runCalls: RunCall[] = [];
  let server = await startFixtureServer(mainRoot, runCalls);
  try {
    const gitRepo = await createGitRepo(path.join(mainRoot, "git-project"));
    const gitProject = await createProject(server.url, gitRepo, true);
    const worktreeSession = await createSession(server.url, "worktree on", gitProject.projectId);
    await postMessage(server.url, worktreeSession.sessionId, "@dev write isolated file");
    const worktreeState = await waitForState(server.url, worktreeSession.sessionId, (state) =>
      state.messages.some((message) => message.speaker === "agent" && message.body.includes("fake codex")),
    );
    const worktreeCall = runCalls.at(-1);
    assert(worktreeCall !== undefined, "worktree-on run did not call Codex");
    const originalStatusAfterWorktree = await gitStatus(gitRepo);
    acceptance.push({
      id: 1,
      statement: "打开一个 git 目录且开启 worktree 开关 → 发送会让 dev 写文件的本地消息 → 应看到 Codex cwd 为临时 worktree、临时 worktree 有改动、原目录 `git status --short` 为空。",
      evidence: {
        projectId: gitProject.projectId,
        codexCwd: worktreeCall.cwd,
        originalFolder: gitRepo,
        cwdIsWorktree: worktreeCall.cwd !== gitRepo,
        worktreeFile: path.join(worktreeCall.cwd, worktreeCall.fileName),
        worktreeFileExists: await pathExists(path.join(worktreeCall.cwd, worktreeCall.fileName)),
        originalGitStatusShort: originalStatusAfterWorktree,
        stateReason: worktreeState.project.worktreeUnavailableReason,
      },
    });
    assert(worktreeCall.cwd !== gitRepo, "worktree-on cwd should not be original repo");
    assert(originalStatusAfterWorktree === "", `original repo is dirty after worktree run: ${originalStatusAfterWorktree}`);

    await updateProject(server.url, gitProject.projectId, false);
    const directSession = await createSession(server.url, "worktree off", gitProject.projectId);
    await postMessage(server.url, directSession.sessionId, "@dev write original file");
    await waitForState(server.url, directSession.sessionId, (state) =>
      state.messages.some((message) => message.speaker === "agent" && message.body.includes("fake codex")),
    );
    const directCall = runCalls.at(-1);
    assert(directCall !== undefined, "worktree-off run did not call Codex");
    const directStatus = await gitStatus(gitRepo);
    acceptance.push({
      id: 2,
      statement: "打开同一个 git 目录且关闭 worktree 开关 → 发送会让 dev 写文件的本地消息 → 应看到 Codex cwd 为原目录、原目录 `git status --short` 显示该改动。",
      evidence: {
        projectId: gitProject.projectId,
        codexCwd: directCall.cwd,
        originalFolder: gitRepo,
        originalGitStatusShort: directStatus,
      },
    });
    assert(directCall.cwd === gitRepo, "worktree-off cwd should be original repo");
    assert(directStatus.includes(directCall.fileName), `original repo status did not include ${directCall.fileName}: ${directStatus}`);

    const plainFolder = path.join(mainRoot, "plain-project");
    await fs.mkdir(plainFolder, { recursive: true });
    const plainProject = await createProject(server.url, plainFolder, true);
    const plainSession = await createSession(server.url, "non git", plainProject.projectId);
    await postMessage(server.url, plainSession.sessionId, "@dev write plain folder");
    const plainState = await waitForState(server.url, plainSession.sessionId, (state) =>
      state.messages.some((message) => message.speaker === "agent" && message.body.includes("fake codex")),
    );
    const plainCall = runCalls.at(-1);
    assert(plainCall !== undefined, "non-git run did not call Codex");
    acceptance.push({
      id: 3,
      statement: "打开非 git 目录且开启 worktree 开关 → 发送会让 dev 写文件的本地消息 → 应看到不初始化 git、不拒收、不调用 `gh`、Codex cwd 为原目录，并可观察到 `worktreeUnavailableReason=not-git-repository`。",
      evidence: {
        projectId: plainProject.projectId,
        codexCwd: plainCall.cwd,
        folderPath: plainFolder,
        gitDirCreated: await pathExists(path.join(plainFolder, ".git")),
        worktreeUnavailableReason: plainState.project.worktreeUnavailableReason,
        fakeGhCalls: await countLogLines(fakeGhLog),
      },
    });
    assert(plainCall.cwd === plainFolder, "non-git cwd should be original folder");
    assert(!(await pathExists(path.join(plainFolder, ".git"))), "non-git flow created .git");
    assert(plainState.project.worktreeUnavailableReason === "not-git-repository", "non-git reason missing");

    const beforeRestart = await getState(server.url, plainSession.sessionId, plainProject.projectId);
    await server.close();
    server = await startFixtureServer(mainRoot, runCalls);
    const afterRestart = await getState(server.url, plainSession.sessionId, plainProject.projectId);
    acceptance.push({
      id: 4,
      statement: "重启桌面壳或 local console server → 打开操作台 project 列表 → 应看到 project 列表与重启前一致，且 `OperatorProject.title` 等于真实目录名。",
      evidence: {
        beforeProjectIds: beforeRestart.projects.map((project) => project.projectId).sort(),
        afterProjectIds: afterRestart.projects.map((project) => project.projectId).sort(),
        restoredTitle: afterRestart.projects.find((project) => project.projectId === plainProject.projectId)?.title,
        expectedTitle: path.basename(plainFolder),
      },
    });
    assert(
      JSON.stringify(beforeRestart.projects.map((project) => project.projectId).sort()) ===
        JSON.stringify(afterRestart.projects.map((project) => project.projectId).sort()),
      "project list changed after restart",
    );
    assert(afterRestart.projects.find((project) => project.projectId === plainProject.projectId)?.title === path.basename(plainFolder), "project title did not restore real folder name");

    acceptance.push({
      id: 5,
      statement: "跑 `pnpm exec tsx scripts/acceptance/local-console-t46.ts` → 应输出/记录 fake `gh` 调用次数为 0。",
      evidence: {
        scope: "local-console project/workspace API and runtime flows; desktop env doctor is excluded",
        fakeGhCalls: await countLogLines(fakeGhLog),
        fakeGhLog: relativeToProject(fakeGhLog),
      },
    });
    assert((await countLogLines(fakeGhLog)) === 0, "project/workspace flow called gh");
  } finally {
    await server.close();
  }

  acceptance.push(await runFakeGitTimeoutScenario(originalPath));
  acceptance.push(await runSqliteMigrationScenario());
  acceptance.push(await runDeletedFolderScenario(originalPath));
  acceptance.push(await runFakeGhAndFolderPickerEvidence(originalPath));

  const evidence: Evidence = {
    acceptance,
    artifacts: { evidence: evidencePath },
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, evidence: evidence.artifacts.evidence, acceptance: acceptance.length })}\n`);
}

async function startFixtureServer(root: string, runCalls: RunCall[], options: { workspaceGitTimeoutMs?: number } = {}): Promise<StartedLocalConsoleServer> {
  await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
  return await startLocalConsoleServer({
    projectRoot: root,
    workdirRoot: path.join(root, "workdir"),
    port: 0,
    storeTimeoutMs: 1_000,
    workspaceGitTimeoutMs: options.workspaceGitTimeoutMs,
    makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
    runCodex: async (runOptions) => {
      const fileName = `codex-${String(runCalls.length + 1)}.txt`;
      await fs.writeFile(path.join(runOptions.cwd, fileName), `cwd=${runOptions.cwd}\n`, "utf8");
      runCalls.push({ cwd: runOptions.cwd, runDir: runOptions.runDir, fileName });
      return codexOk(runOptions, "fake codex done");
    },
  });
}

async function runFakeGitTimeoutScenario(originalPath: string): Promise<Evidence["acceptance"][number]> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-t46-git-timeout-"));
  const fakeBin = path.join(root, "fake-bin");
  const gitLog = path.join(root, "fake-git.log");
  const marker = path.join(root, "fake-git-marker");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(
    path.join(fakeBin, "git"),
    `#!/bin/sh
printf '%s\\n' "$*" >> '${gitLog}'
if [ ! -f '${marker}' ]; then
  touch '${marker}'
  sleep 5
  exit 0
fi
exit 128
`,
    { mode: 0o755 },
  );
  process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
  const calls: RunCall[] = [];
  const server = await startFixtureServer(root, calls, { workspaceGitTimeoutMs: 100 });
  try {
    const folderPath = path.join(root, "folder");
    await fs.mkdir(folderPath, { recursive: true });
    const project = await createProject(server.url, folderPath, true);
    const session = await createSession(server.url, "fake git timeout", project.projectId);
    await postMessage(server.url, session.sessionId, "@dev timeout once");
    const failed = await waitForState(server.url, session.sessionId, (state) =>
      state.messages.some((message) => message.error?.includes("workspace-git-timeout") === true),
    );
    await updateProject(server.url, project.projectId, false);
    await postMessage(server.url, session.sessionId, "@dev continue after timeout");
    const recovered = await waitForState(server.url, session.sessionId, (state) =>
      state.messages.some((message) => message.speaker === "agent" && message.body.includes("fake codex")),
    );
    return {
      id: 6,
      statement: "用 fake `git` 让 `rev-parse` 或 `worktree add` 永久挂起 → 系统应在配置超时内记录可见 failed/stuck，active run 清空，同一 session 再发一条消息应能继续处理。",
      evidence: {
        firstFailure: failed.messages.find((message) => message.error?.includes("workspace-git-timeout") === true),
        activeRunAfterFailure: failed.activeRun,
        recoveredAgentMessage: recovered.messages.find((message) => message.speaker === "agent"),
        recoveryMode: "worktree disabled after bounded git failure",
        codexCallsAfterRecovery: calls.length,
        fakeGitCalls: await countLogLines(gitLog),
      },
    };
  } finally {
    await server.close();
    process.env.PATH = originalPath;
  }
}

async function runSqliteMigrationScenario(): Promise<Evidence["acceptance"][number]> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-t46-sqlite-"));
  const sqlitePath = path.join(root, ".state", "local-console.sqlite");
  await fs.mkdir(path.dirname(sqlitePath), { recursive: true });
  const database = new DatabaseSync(sqlitePath);
  try {
    database.exec(`
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_owner TEXT,
        source_repo TEXT,
        source_issue_number INTEGER,
        parent_session_id TEXT,
        title TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE session_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        speaker TEXT NOT NULL,
        role TEXT,
        body TEXT NOT NULL,
        status TEXT NOT NULL,
        run_id TEXT,
        run_dir TEXT,
        error TEXT,
        source_kind TEXT,
        source_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE local_message_cursors (
        session_id TEXT PRIMARY KEY,
        processed_through_message_id INTEGER NOT NULL DEFAULT 0,
        active_message_id INTEGER,
        active_run_id TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO sessions
        (session_id, source_type, source_owner, source_repo, source_issue_number, parent_session_id, title, status, created_at, updated_at)
      VALUES ('local:legacy', 'local', NULL, NULL, NULL, NULL, 'legacy session', 'active', '2026-07-09T00:00:00.000Z', '2026-07-09T00:00:01.000Z');
      INSERT INTO session_messages
        (session_id, speaker, role, body, status, run_id, run_dir, error, source_kind, source_id, created_at, updated_at)
      VALUES ('local:legacy', 'user', NULL, '@dev old', 'failed', 'run-old', '/tmp/run-old', 'old-error', 'local-message', '1', '2026-07-09T00:00:02.000Z', '2026-07-09T00:00:03.000Z');
      INSERT INTO local_message_cursors
        (session_id, processed_through_message_id, active_message_id, active_run_id, updated_at)
      VALUES ('local:legacy', 1, NULL, NULL, '2026-07-09T00:00:04.000Z');
    `);
  } finally {
    database.close();
  }

  const store = await createSqliteLocalConsoleStore({ sqlitePath });
  await store.init();
  let invalidFailed = false;
  try {
    await store.createSession({
      sessionId: "local:invalid-project",
      projectId: "missing-project",
      title: "invalid",
      now: "2026-07-09T00:00:05.000Z",
    });
  } catch {
    invalidFailed = true;
  } finally {
    await store.close();
  }

  const migrated = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const session = migrated.prepare("SELECT session_id, project_id, title FROM sessions WHERE session_id = 'local:legacy'").get();
    const message = migrated.prepare("SELECT status, run_dir, error FROM session_messages WHERE session_id = 'local:legacy'").get();
    const cursor = migrated.prepare("SELECT processed_through_message_id FROM local_message_cursors WHERE session_id = 'local:legacy'").get();
    const invalid = migrated.prepare("SELECT session_id FROM sessions WHERE session_id = 'local:invalid-project'").get();
    return {
      id: 7,
      statement: "用旧版 SQLite fixture 含 local sessions、messages、cursor、runDir、错误状态 → 启动迁移后应看到每个 local session 的 `project_id` 引用已存在 project，消息、cursor、status、runDir 不变；用不存在 projectId 创建 session 应失败且不写半条消息。",
      evidence: {
        migratedSession: session,
        migratedMessage: message,
        migratedCursor: cursor,
        invalidProjectCreateFailed: invalidFailed,
        invalidSessionRow: invalid ?? null,
      },
    };
  } finally {
    migrated.close();
  }
}

async function runDeletedFolderScenario(originalPath: string): Promise<Evidence["acceptance"][number]> {
  process.env.PATH = originalPath;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-t46-deleted-folder-"));
  const calls: RunCall[] = [];
  const server = await startFixtureServer(root, calls);
  try {
    const deletedFolder = path.join(root, "deleted-project");
    await fs.mkdir(deletedFolder, { recursive: true });
    const badProject = await createProject(server.url, deletedFolder, false);
    const badSession = await createSession(server.url, "deleted folder", badProject.projectId);
    await fs.rm(deletedFolder, { recursive: true, force: true });
    await postMessage(server.url, badSession.sessionId, "@dev should fail visibly");
    const failed = await waitForState(server.url, badSession.sessionId, (state) =>
      state.messages.some((message) => message.error?.includes("ENOENT") === true || message.error?.includes("no such file") === true),
    );

    const goodFolder = path.join(root, "good-project");
    await fs.mkdir(goodFolder, { recursive: true });
    const goodProject = await createProject(server.url, goodFolder, false);
    const goodSession = await createSession(server.url, "good folder", goodProject.projectId);
    await postMessage(server.url, goodSession.sessionId, "@dev should still run");
    const recovered = await waitForState(server.url, goodSession.sessionId, (state) =>
      state.messages.some((message) => message.speaker === "agent" && message.body.includes("fake codex")),
    );
    return {
      id: 8,
      statement: "创建 project 后删除或改名 folderPath 再发消息 → 系统应在超时内给出可见本地错误，不删除 project row，不丢原 session timeline，其他 project/session 仍可运行。",
      evidence: {
        deletedProjectStillPresent: failed.projects.some((project) => project.projectId === badProject.projectId),
        failedTimelineLength: failed.messages.length,
        failure: failed.messages.find((message) => message.error !== null),
        recoveredProjectId: goodProject.projectId,
        recoveredAgentMessage: recovered.messages.find((message) => message.speaker === "agent"),
        codexCalls: calls.length,
      },
    };
  } finally {
    await server.close();
  }
}

async function runFakeGhAndFolderPickerEvidence(originalPath: string): Promise<Evidence["acceptance"][number]> {
  process.env.PATH = originalPath;
  const mainSource = await fs.readFile(path.join(projectRoot, "desktop", "src", "main.ts"), "utf8");
  const handlerIndex = mainSource.indexOf('ipcMain.handle("project:select-folder"');
  assert(handlerIndex >= 0, "folder picker IPC handler not found");
  const handlerBlock = mainSource.slice(handlerIndex, mainSource.indexOf("});", handlerIndex) + 3);
  const preloadSource = await fs.readFile(path.join(projectRoot, "desktop", "src", "preload.ts"), "utf8");
  assert(handlerBlock.includes("dialog.showOpenDialog"), "folder picker IPC must use Electron dialog");
  assert(!handlerBlock.includes("gh"), "folder picker IPC must not call gh");
  assert(preloadSource.includes("selectProjectFolder"), "preload must expose selectProjectFolder");
  return {
    id: 9,
    statement: "在 fake `gh` 置于 PATH 的环境跑打开文件夹、project create、worktree on/off、非 git 降级流程 → 应看到 project/workspace 路径没有任何 `gh` 调用；若排除桌面 env doctor，证据必须显式说明排除范围，并单独验证 folder picker IPC 不调用 `gh`。",
    evidence: {
      scope: "acceptance scenarios 1-5 ran project/workspace API and runtime with fake gh in PATH; desktop env doctor intentionally excluded",
      folderPickerHandlerUsesDialog: handlerBlock.includes("dialog.showOpenDialog"),
      folderPickerHandlerMentionsGh: handlerBlock.includes("gh"),
      preloadExposesSelectProjectFolder: preloadSource.includes("selectProjectFolder"),
    },
  };
}

async function createProject(url: string, folderPath: string, worktreeMode: boolean): Promise<{ projectId: string }> {
  const response = await fetch(new URL("/api/local-console/projects", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ folderPath, worktreeMode }),
  });
  if (response.status !== 201) {
    throw new Error(`create project failed: ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { project: { projectId: string } }).project;
}

async function updateProject(url: string, projectId: string, worktreeMode: boolean): Promise<void> {
  const response = await fetch(new URL(`/api/local-console/projects/${encodeURIComponent(projectId)}`, url), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ worktreeMode }),
  });
  if (response.status !== 200) {
    throw new Error(`update project failed: ${response.status} ${await response.text()}`);
  }
}

async function createSession(url: string, title: string, projectId: string): Promise<{ sessionId: string }> {
  const response = await fetch(new URL("/api/local-console/sessions", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, projectId }),
  });
  if (response.status !== 201) {
    throw new Error(`create session failed: ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { session: { sessionId: string } }).session;
}

async function postMessage(url: string, sessionId: string, body: string): Promise<void> {
  const response = await fetch(new URL(`/api/local-console/sessions/${encodeURIComponent(sessionId)}/messages`, url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (response.status !== 202) {
    throw new Error(`post message failed: ${response.status} ${await response.text()}`);
  }
}

async function getState(url: string, sessionId: string, projectId?: string): Promise<LocalState> {
  const stateUrl = new URL("/api/local-console/state", url);
  stateUrl.searchParams.set("sessionId", sessionId);
  if (projectId !== undefined) {
    stateUrl.searchParams.set("projectId", projectId);
  }
  const response = await fetch(stateUrl);
  if (response.status !== 200) {
    throw new Error(`state failed: ${response.status} ${await response.text()}`);
  }
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
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for state: ${JSON.stringify(latest)}`);
}

async function createGitRepo(repoPath: string): Promise<string> {
  await fs.mkdir(repoPath, { recursive: true });
  await run("git", ["init"], repoPath);
  await run("git", ["config", "user.email", "t46@example.invalid"], repoPath);
  await run("git", ["config", "user.name", "T46 Acceptance"], repoPath);
  await fs.writeFile(path.join(repoPath, "README.md"), "t46\n", "utf8");
  await run("git", ["add", "README.md"], repoPath);
  await run("git", ["commit", "-m", "initial"], repoPath);
  return repoPath;
}

async function gitStatus(repoPath: string): Promise<string> {
  const result = await run("git", ["status", "--short"], repoPath);
  return result.stdout.trim();
}

async function run(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with ${String(code)}: ${stderr}`));
    });
  });
}

async function installFakeCommand(binDir: string, name: string, logPath: string): Promise<void> {
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, name),
    `#!/bin/sh
printf '%s %s\\n' '${name}' "$*" >> '${logPath}'
exit 0
`,
    { mode: 0o755 },
  );
}

async function writeAgent(root: string, name: string, body: string): Promise<void> {
  const agentsDir = path.join(root, "agents");
  await fs.mkdir(agentsDir, { recursive: true });
  await fs.writeFile(path.join(agentsDir, `${name}.md`), body, "utf8");
}

function codexOk(options: CodexRunOptions, finalText: string): CodexRunResult {
  return {
    ok: true,
    finalText,
    threadId: null,
    cachedInputTokens: null,
    runDir: options.runDir,
    stdoutPath: path.join(options.runDir, "stdout.jsonl"),
    stderrPath: path.join(options.runDir, "stderr.log"),
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function countLogLines(logPath: string): Promise<number> {
  try {
    const raw = await fs.readFile(logPath, "utf8");
    return raw.trim() === "" ? 0 : raw.trim().split(/\n/u).length;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

function relativeToProject(targetPath: string): string {
  return path.relative(projectRoot, targetPath);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
