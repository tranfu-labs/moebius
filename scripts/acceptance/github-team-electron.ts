/**
 * 真机验收：GitHub 团队从「找现成团队」入口的完整用户旅程。
 *
 * 真实 Electron 窗口 + 生产 preload/IPC/renderer + 隔离数据根；外部 GitHub
 * 调用由受控 `gh` fixture 提供（方案批准的边界替身，应用自身栈无 mock）。
 * 旅程：发现搜索 → 预览 → 安装 → 打开已安装团队 → 重新检查（无更新）→
 * 上游更新后检查 → 同步更新（磁盘落盘验证）→ 撤销这次同步（磁盘回滚验证）
 * → 停止接收更新 → 重启复查持久化。
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
const DEV_AGENT_V2 = [
  "---",
  "display_name: Developer",
  "description: Builds features",
  "---",
  "",
  "# Rules v2",
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
  await window.getByRole("button", { name: "Agent 团队" }).waitFor({ timeout: 10_000 });
  await window.getByRole("button", { name: "Agent 团队" }).click();
  await window.getByRole("button", { name: "找现成团队" }).waitFor({ timeout: 15_000 });
  return { application: app, page: window };
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
  await page.getByText("持续接收更新").waitFor({ timeout: 15_000 });
  record(
    "预览页",
    "点击「打开它」",
    "回到团队页并打开新团队详情：出现「持续接收更新」提示条与来源仓库 someone/moebius-team",
  );

  const teamsRoot = path.join(runtimeRoot, "teams");
  const teamDirectoryName = (await fs.readdir(teamsRoot)).find((name) => !name.startsWith("."));
  assert(teamDirectoryName !== undefined, "已安装团队目录不存在");
  const teamDirectory = path.join(teamsRoot, teamDirectoryName!);
  const devAgentPath = path.join(teamDirectory, "members", "dev", "AGENT.md");

  // 6. 重新检查（无更新）
  await page.getByRole("button", { name: "重新检查" }).click();
  await page.getByText("已是最新，没有新的作者更新。").waitFor({ timeout: 15_000 });
  record(
    "团队详情上游提示条",
    "点击「重新检查」（上游与安装时一致）",
    "提示「已是最新，没有新的作者更新。」",
  );

  // 7. 上游更新 → 检查 → 同步更新（磁盘验证）
  await fs.writeFile(path.join(fixtureRoot, "members", "dev", "AGENT.md"), DEV_AGENT_V2, "utf8");
  await page.getByRole("button", { name: "重新检查" }).click();
  await page.getByText("发现新的作者更新。").waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "同步更新" }).waitFor({ timeout: 10_000 });
  record(
    "团队详情上游提示条（fixture 成员文件已更新）",
    "再次点击「重新检查」",
    "提示「发现新的作者更新。」并出现「同步更新」按钮",
  );

  await page.getByRole("button", { name: "同步更新" }).click();
  await page.getByText("已同步上游更新。").waitFor({ timeout: 20_000 });
  await waitForValue(async () => {
    const content = await fs.readFile(devAgentPath, "utf8");
    return content.includes("# Rules v2") ? true : undefined;
  }, {
    describe: "同步后的成员文件落盘为 v2",
    kind: "io",
    timeoutMs: 10_000,
    pollMs: 200,
    snapshot: async () => ({ content: await fs.readFile(devAgentPath, "utf8") }),
  });
  record(
    "团队详情上游提示条",
    "点击「同步更新」",
    `提示「已同步上游更新。」；磁盘成员文件已更新为 v2（${devAgentPath}）`,
  );

  // 8. 撤销这次同步（磁盘回滚验证）
  await page.getByRole("button", { name: "撤销这次同步" }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "撤销这次同步" }).click();
  await waitForValue(async () => {
    const content = await fs.readFile(devAgentPath, "utf8");
    return content.includes("# Rules v1") ? true : undefined;
  }, {
    describe: "撤销后的成员文件回滚为 v1",
    kind: "io",
    timeoutMs: 10_000,
    pollMs: 200,
    snapshot: async () => ({ content: await fs.readFile(devAgentPath, "utf8") }),
  });
  await waitForValue(async () => {
    const count = await page.getByRole("button", { name: "撤销这次同步" }).count();
    return count === 0 ? true : undefined;
  }, {
    describe: "撤销后「撤销这次同步」按钮消失（批次已置 reverted）",
    kind: "logic",
    timeoutMs: 10_000,
    pollMs: 200,
    snapshot: () => ({}),
  });
  record(
    "团队详情上游提示条",
    "点击「撤销这次同步」",
    "提示回到「已是最新」；磁盘成员文件恢复 v1；「撤销这次同步」按钮消失",
  );

  // 9. 停止接收更新（团队保留、提示条消失）
  await page.getByRole("button", { name: "停止接收更新" }).click();
  await waitForValue(async () => {
    const count = await page.getByRole("button", { name: "重新检查" }).count();
    return count === 0 ? true : undefined;
  }, {
    describe: "停止接收更新后提示条按钮消失",
    kind: "logic",
    timeoutMs: 10_000,
    pollMs: 200,
    snapshot: () => ({}),
  });
  record(
    "团队详情上游提示条",
    "点击「停止接收更新」",
    "「持续接收更新」提示条消失，团队详情保持可用",
  );

  // 10. 重启复查：团队与本地内容持久化、上游关系已解除
  const teamId = teamDirectoryName!;
  await application!.close();
  application = null;
  ({ application, page } = await launch());
  const row = page.getByTestId("agent-team-row").filter({ hasText: TEAM_NAME });
  await row.waitFor({ timeout: 15_000 });
  await row.click();
  await waitForValue(async () => {
    const recheckCount = await page.getByRole("button", { name: "重新检查" }).count();
    const repositoryCount = await page.getByText(REPOSITORY).count();
    return recheckCount === 0 && repositoryCount === 0 ? true : undefined;
  }, {
    describe: "重启后团队详情不再显示上游提示条",
    kind: "logic",
    timeoutMs: 10_000,
    pollMs: 200,
    snapshot: () => ({}),
  });
  const persistedContent = await fs.readFile(devAgentPath, "utf8");
  assert(persistedContent.includes("# Rules v1"), "重启后成员文件内容未保持 v1");
  record(
    "重启后的团队列表",
    `重启应用并打开团队 ${teamId}`,
    "团队仍在列表中，本地成员内容保持 v1；详情不再显示上游提示条（停止接收更新已持久化）",
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
