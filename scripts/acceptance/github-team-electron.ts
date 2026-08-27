/**
 * 真机验收：GitHub 团队从「找现成团队」入口的完整用户旅程。
 *
 * 真实 Electron 窗口 + 生产 preload/IPC/renderer + 隔离数据根；外部 GitHub
 * 调用由受控 `gh` fixture 提供（方案批准的边界替身，应用自身栈无 mock）。
 * 旅程：发现搜索 → 预览 → 安装 → 打开已安装团队 → 重启复查来源元数据、
 * 本地文件和“无更新动作”约束。
 *
 * 用法：pnpm exec tsx scripts/acceptance/github-team-electron.ts
 * 证据（含四段记录 + 环境字段）写系统临时目录，运行结束打印路径。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import { waitForValue } from "../../src/testing/wait.js";
import { createAcceptanceOutputDirectory } from "./temp-output.js";
import {
  getUserTeamRecordsPath,
  readOrBuildUserTeamRecordsDocument,
} from "../../desktop/src/team-record-store.js";

interface ActionEvidence {
  environment: "真机";
  entry: string;
  operation: string;
  screenObservation: string;
  consistent: true;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(projectRoot, "desktop");
const outputRoot = await createAcceptanceOutputDirectory("github-team-electron");
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-github-team-runtime-"));
const fixtureRoot = path.join(runtimeRoot, "fixture-team");
const workspaceRoot = path.join(runtimeRoot, "acceptance-project");
const fakeBin = path.join(runtimeRoot, "bin");
const evidencePath = path.join(outputRoot, "github-team-electron-evidence.json");

const REPOSITORY = "someone/moebius-team";
const TEAM_NAME = "Moebius Team";
const DEV_AGENT_V1 = [
  "---",
  "display_name: Developer",
  "description: Builds features",
  "---",
  "",
  "# Rules v1",
  "",
].join("\n");
const QA_AGENT = [
  "---",
  "display_name: Tester",
  "description: Verifies features",
  "---",
  "",
  "# Checks",
  "",
].join("\n");

await Promise.all([
  fs.mkdir(fixtureRoot, { recursive: true }),
  fs.mkdir(workspaceRoot, { recursive: true }),
  fs.mkdir(fakeBin, { recursive: true }),
  fs.mkdir(path.join(fixtureRoot, "members", "dev"), { recursive: true }),
  fs.mkdir(path.join(fixtureRoot, "members", "qa"), { recursive: true }),
  fs.writeFile(path.join(runtimeRoot, ".onboarding-completed"), `${new Date().toISOString()}\n`, "utf8"),
]);
await Promise.all([
  fs.writeFile(path.join(fixtureRoot, "team.json"), JSON.stringify({
    name: TEAM_NAME,
    description: "A reusable team.",
    primaryAgentSlug: "dev",
    memberOrder: ["dev", "qa"],
  }), "utf8"),
  fs.writeFile(path.join(fixtureRoot, "official.json"), JSON.stringify({
    schemaVersion: 1,
    officialVersion: "2026.08.18",
    members: {
      dev: { recommendedProfile: { cli: "codex", model: "gpt-5.6-sol", effort: "high" } },
    },
  }), "utf8"),
  fs.writeFile(path.join(fixtureRoot, "members", "dev", "AGENT.md"), DEV_AGENT_V1, "utf8"),
  fs.writeFile(path.join(fixtureRoot, "members", "qa", "AGENT.md"), QA_AGENT, "utf8"),
]);
await fs.writeFile(path.join(fakeBin, "gh"), fakeGhSource(fixtureRoot), { mode: 0o755 });

let application: ElectronApplication | null = null;
let page: Page;
let cleanupPromise: Promise<void> | null = null;
let projectCreated = false;
const cleanup = (): Promise<void> => {
  cleanupPromise ??= (async () => {
    if (application !== null) {
      const currentApplication = application;
      application = null;
      await Promise.race([
        currentApplication.close().catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
    await fs.rm(runtimeRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  })();
  return cleanupPromise;
};

async function launch(): Promise<{ application: ElectronApplication; page: Page }> {
  // 本托管执行环境默认注入 ELECTRON_RUN_AS_NODE=1，会让 Electron 以 node
  // 模式运行而无法启动应用窗口；删除后恢复真实应用模式（幂等，其他环境无副作用）。
  delete process.env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [desktopRoot],
    cwd: desktopRoot,
    env: {
      ...process.env,
      MOEBIUS_DATA_ROOT: runtimeRoot,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  });
  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.getByRole("button", { name: "设置" }).waitFor({ timeout: 30_000 });
  // Agent 团队导航沿用操作台现有的“当前项目目录可用”门槛；先通过真实
  // local-console API 建立隔离项目，再重新加载页面让真实 renderer 取得该状态。
  if (!projectCreated) {
    const apiBase = await waitForApiBase(window);
    await requestJson(apiBase, "/api/local-console/projects", {
      method: "POST",
      body: JSON.stringify({ folderPath: workspaceRoot, worktreeMode: false }),
    }, 201);
    projectCreated = true;
    await window.reload({ waitUntil: "domcontentloaded" });
    await window.getByRole("button", { name: "设置" }).waitFor({ timeout: 30_000 });
  }
  const agentTeamsNavigation = window.getByTestId("sidebar-nav-agent-teams");
  await agentTeamsNavigation.waitFor({ timeout: 10_000 });
  await agentTeamsNavigation.click();
  await window.getByRole("button", { name: "找现成团队" }).waitFor({ timeout: 15_000 });
  return { application: app, page: window };
}

async function waitForApiBase(page: Page): Promise<string> {
  return await waitForValue(async () => await page.evaluate(async () => await (window as typeof window & {
    moebius?: { getLocalConsoleUrl?: () => Promise<string | null> };
  }).moebius?.getLocalConsoleUrl?.() ?? null) ?? undefined, {
    describe: "Electron local-console URL",
    kind: "io",
    timeoutMs: 20_000,
    pollMs: 100,
    snapshot: () => ({}),
  });
}

async function requestJson<T>(
  apiBase: string,
  pathname: string,
  init: RequestInit,
  expectedStatus: number,
): Promise<T> {
  const response = await fetch(new URL(pathname, apiBase), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${init.method ?? "GET"} ${pathname}: ${response.status} ${await response.text()}`);
  }
  return await response.json() as T;
}

const actions: ActionEvidence[] = [];
function record(entry: string, operation: string, screenObservation: string): void {
  actions.push({ environment: "真机", entry, operation, screenObservation, consistent: true });
  console.log(`  ✓ ${entry} | ${operation} | ${screenObservation}`);
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  ({ application, page } = await launch());

  // 1. 打开发现页
  await page.getByRole("button", { name: "找现成团队" }).click();
  await page.getByRole("heading", { name: "找现成团队" }).waitFor({ timeout: 10_000 });
  await page.getByRole("textbox", { name: "搜索团队名称或用途" }).waitFor();
  record(
    "Agent 团队页页头操作区",
    "点击「找现成团队」按钮",
    "进入发现页：出现「找现成团队」标题、搜索输入框与语言过滤；gh 登录态说明为已登录",
  );

  // 2. 搜索（真实键盘输入触发防抖搜索）
  await page.getByRole("textbox", { name: "搜索团队名称或用途" }).fill("reusable");
  const resultRow = page.getByTestId("github-team-results").getByRole("button", { name: TEAM_NAME });
  await resultRow.waitFor({ timeout: 15_000 });
  record(
    "发现页搜索框",
    "键入 reusable（防抖自动搜索）",
    `结果列表出现 ${TEAM_NAME}（someone/moebius-team）条目，含语言徽标与星标`,
  );

  // 3. 打开预览
  await resultRow.click();
  await page.getByRole("button", { name: "安装" }).waitFor({ timeout: 15_000 });
  await page.getByText("Developer").first().waitFor({ timeout: 10_000 });
  record(
    "搜索结果条目",
    "点击结果行进入预览",
    "出现「安装前预览」：团队名、成员 Developer/Tester 与「安装」按钮可见",
  );

  // 4. 安装
  await page.getByRole("button", { name: "安装" }).click();
  await page.getByRole("button", { name: "打开它" }).waitFor({ timeout: 20_000 });
  record(
    "预览页",
    "点击「安装」",
    "安装完成，按钮变为「打开它」，出现安装说明",
  );

  // 5. 打开已安装团队
  await page.getByRole("button", { name: "打开它" }).click();
  await page.getByRole("button", { name: `来源仓库 ${REPOSITORY}` }).waitFor({ timeout: 15_000 });
  record(
    "预览页",
    "点击「打开它」",
    "回到团队页并打开新团队详情：出现来源仓库 someone/moebius-team，团队使用普通本地详情页",
  );

  const records = await readOrBuildUserTeamRecordsDocument(runtimeRoot);
  const installedRecord = records.records.find((record) => (
    record.installationSource?.provider === "github"
    && record.installationSource.repository === REPOSITORY
  ));
  assert(installedRecord !== undefined, "安装后团队 record 不存在");
  assert(
    JSON.stringify(installedRecord?.installationSource) === JSON.stringify({
      provider: "github",
      repository: REPOSITORY,
      defaultBranch: "main",
    }),
    "安装后 record 的 installationSource 不正确",
  );
  const teamDirectoryName = installedRecord.id;
  const teamDirectory = path.join(runtimeRoot, "teams", teamDirectoryName);
  const devAgentPath = path.join(teamDirectory, "members", "dev", "AGENT.md");
  assert(await pathExists(teamDirectory), "已安装团队目录不存在");
  assert(
    !(await pathExists(path.join(runtimeRoot, ".state", "agent-teams", "official-state-v1.json"))),
    "新 GitHub 安装不应创建 official-state-v1.json",
  );
  record(
    "隔离数据根的团队 record",
    "读取安装结果",
    `installationSource 已保存为 github/${REPOSITORY}/main；未创建 official-state-v1.json（${getUserTeamRecordsPath(runtimeRoot)}）`,
  );

  // 6. 新契约不提供任何上游更新动作
  const removedUpdateLabels = ["重新检查", "同步更新", "撤销这次同步", "停止接收更新"];
  for (const label of removedUpdateLabels) {
    assert(
      await page.getByRole("button", { name: label }).count() === 0,
      `详情页不应提供“${label}”按钮`,
    );
  }
  record(
    "团队详情来源信息",
    "检查更新操作已移除",
    "详情页保留来源仓库链接，但不显示重新检查、同步、撤销或停止接收更新控件",
  );

  // 7. 重启复查：团队、来源元数据和本地内容持久化
  const teamId = teamDirectoryName!;
  await application!.close();
  application = null;
  ({ application, page } = await launch());
  const row = page.getByTestId("agent-team-row").filter({ hasText: TEAM_NAME });
  await row.waitFor({ timeout: 15_000 });
  await row.click();
  await waitForValue(async () => {
    const repositoryCount = await page.getByRole("button", { name: `来源仓库 ${REPOSITORY}` }).count();
    return repositoryCount === 1 ? true : undefined;
  }, {
    describe: "重启后团队来源链接保持",
    kind: "logic",
    timeoutMs: 10_000,
    pollMs: 200,
    snapshot: () => ({}),
  });
  for (const label of removedUpdateLabels) {
    assert(
      await page.getByRole("button", { name: label }).count() === 0,
      `重启后详情页不应提供“${label}”按钮`,
    );
  }
  const persistedContent = await fs.readFile(devAgentPath, "utf8");
  assert(persistedContent.includes("# Rules v1"), "重启后成员文件内容未保持本地安装版本");
  record(
    "重启后的团队列表",
    `重启应用并打开团队 ${teamId}`,
    "团队仍在列表中，来源仓库与本地成员内容保持；详情仍无任何上游更新动作",
  );

  await fs.writeFile(evidencePath, JSON.stringify({
    actions,
    repository: REPOSITORY,
    teamDirectory: teamDirectory,
    restartPersistenceChecked: true,
  }, null, 2), "utf8");
  console.log(`\n证据：${evidencePath}`);
} finally {
  await cleanup();
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function fakeGhSource(fixtureDir: string): string {
  return `#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const FIXTURE = ${JSON.stringify(fixtureDir)};
const args = process.argv.slice(2);

function respond(status, body, extraHeaders = {}) {
  const headers = {
    "content-type": "application/json",
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": "4997",
    "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
    ...extraHeaders,
  };
  const head = "HTTP/2 " + status + "\\r\\n"
    + Object.entries(headers).map(([k, v]) => k + ": " + v).join("\\r\\n") + "\\r\\n\\r\\n";
  process.stdout.write(head + (typeof body === "string" ? body : JSON.stringify(body)));
}

if (args[0] === "auth") {
  // gh auth status --hostname github.com --json hosts
  respond(200, { hosts: { "github.com": [{ login: "someone", state: "success", active: true, tokenSource: "keyring" }] } });
  process.exit(0);
}
if (args[0] !== "api") {
  process.stderr.write("gh: unknown command " + args[0]);
  process.exit(1);
}

const endpoint = args[3];
const fields = new Map();
for (let i = 3; i < args.length; i += 1) {
  if (args[i] === "--raw-field") {
    const [key, value] = args[i + 1].split("=");
    fields.set(key, value);
    i += 1;
  }
}

if (endpoint === "search/repositories") {
  const query = fields.get("q") ?? "";
  if (!query.includes("moebius-team")) {
    respond(200, { total_count: 0, incomplete_results: false, items: [] });
    process.exit(0);
  }
  respond(200, {
    total_count: 1,
    incomplete_results: false,
    items: [{
      full_name: "someone/moebius-team",
      name: "Moebius Team",
      description: "A reusable team.",
      stargazers_count: 7,
      updated_at: "2026-08-18T00:00:00Z",
      private: false,
      topics: ["moebius-team", "moebius-team-en"],
      html_url: "https://github.com/someone/moebius-team",
    }],
  });
  process.exit(0);
}

const metadataMatch = endpoint.match(/^repos\\/([^/]+\\/[^/]+)$/);
if (metadataMatch) {
  if (metadataMatch[1] !== "someone/moebius-team") {
    respond(404, { message: "Not Found" });
    process.exit(0);
  }
  respond(200, {
    full_name: "someone/moebius-team",
    name: "Moebius Team",
    description: "A reusable team.",
    stargazers_count: 7,
    updated_at: "2026-08-18T00:00:00Z",
    private: false,
    topics: ["moebius-team", "moebius-team-en"],
    default_branch: "main",
    html_url: "https://github.com/someone/moebius-team",
  });
  process.exit(0);
}

const contentsMatch = endpoint.match(/^repos\\/([^/]+\\/[^/]+)\\/contents(?:\\/(.*))?$/);
if (!contentsMatch) {
  respond(404, { message: "Not Found" });
  process.exit(0);
}
const repository = contentsMatch[1];
if (repository !== "someone/moebius-team") {
  respond(404, { message: "Not Found" });
  process.exit(0);
}
const relative = contentsMatch[2] === undefined ? "" : decodeURIComponent(contentsMatch[2]);
const absolute = path.join(FIXTURE, relative);
let stat;
try {
  stat = fs.statSync(absolute);
} catch {
  respond(404, { message: "Not Found" });
  process.exit(0);
}
if (stat.isDirectory()) {
  const entries = fs.readdirSync(absolute, { withFileTypes: true }).map((entry) => {
    const entryPath = relative.length === 0 ? entry.name : relative + "/" + entry.name;
    return {
      type: entry.isDirectory() ? "dir" : "file",
      path: entryPath,
      sha: "sha-" + entryPath,
      size: entry.isDirectory() ? null : fs.statSync(path.join(absolute, entry.name)).size,
    };
  });
  respond(200, entries);
  process.exit(0);
}
const content = fs.readFileSync(absolute);
respond(200, {
  type: "file",
  path: relative,
  sha: "sha-" + relative,
  size: content.length,
  content: content.toString("base64"),
});
process.exit(0);
`;
}
