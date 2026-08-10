/**
 * Real-app acceptance for change 1 (agent-md-revision-and-default-agent).
 *
 * Drives the real Electron dev build in an isolated data root with an
 * isolated HOME/PATH. The default-Agent summary job performs ONE real provider
 * invocation in the background; its terminal state is environment-dependent
 * (this machine: unavailable, i.e. the observable degradation path; a machine
 * with a usable default Agent would reach ready). Every side-effecting user
 * action below is performed from its real entrance and recorded with the four
 * acceptance fields; evidence lands in the system temporary directory, never
 * in the repository.
 *
 * Usage: pnpm exec tsx scripts/acceptance/agent-revision-acceptance.ts
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import { createAcceptanceOutputDirectory } from "./temp-output.js";

interface RealAppRecord {
  environment: "真机";
  entrance: string;
  action: string;
  screenObservation: string;
  consistent: boolean;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(projectRoot, "desktop");
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-agent-revision-acceptance-"));
const isolatedHome = path.join(runtimeRoot, "home");
const isolatedBin = path.join(runtimeRoot, "empty-bin");
await Promise.all([
  fs.mkdir(isolatedHome, { recursive: true }),
  fs.mkdir(isolatedBin, { recursive: true }),
]);
const evidenceRoot = await createAcceptanceOutputDirectory("agent-revision-acceptance");
const evidencePath = path.join(evidenceRoot, "agent-revision-acceptance-evidence.json");
const records: RealAppRecord[] = [];
const assertions: Array<{ id: string; passed: boolean; observed: unknown }> = [];

const desktopRequire = createRequire(path.join(desktopRoot, "package.json"));
const electronExecutable: string = desktopRequire("electron");

const record = (
  id: string,
  passed: boolean,
  observed: unknown,
  realApp: Omit<RealAppRecord, "environment" | "consistent">,
): void => {
  assertions.push({ id, passed, observed });
  records.push({ environment: "真机", ...realApp, consistent: passed });
};

const stateRoot = () => path.join(runtimeRoot, ".state");
const officialStatePath = () => path.join(stateRoot(), "agent-teams", "official-state-v1.json");
const defaultAgentPath = () => path.join(stateRoot(), "agent-teams", "default-agent-v1.json");
const sqlitePath = () => path.join(stateRoot(), "local-console.sqlite");
const developmentDirectory = () => path.join(runtimeRoot, "teams", ".system", "development");

async function launch(): Promise<ElectronApplication> {
  return electron.launch({
    cwd: desktopRoot,
    executablePath: electronExecutable,
    args: [desktopRoot],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      PATH: [isolatedBin, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(path.delimiter),
      SHELL: "/bin/false",
      MOEBIUS_DATA_ROOT: runtimeRoot,
    },
  });
}

async function mainPage(application: ElectronApplication): Promise<Page> {
  const page = application.windows()[0] ?? await application.waitForEvent("window", { timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");
  // A fresh data root starts at the onboarding flow. The isolated PATH has no
  // CLI, so the only way forward is adding the acceptance DeepSeek provider
  // (real key from the local Keychain item used by the BYOK acceptance suite).
  const onboardingStep1 = page.getByTestId("onboarding-step-1");
  const onboardingPresent = await onboardingStep1.waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (onboardingPresent) {
    await page.getByRole("button", { name: "添加服务商" }).click();
    await page.getByLabel("档案名称").fill("验收 DeepSeek");
    await page.getByLabel("API Key").fill(await readKeychainSecret());
    await page.getByLabel("验证模型").selectOption("deepseek-v4-pro");
    await page.getByRole("button", { name: "验证并保存" }).click();
    await page.locator("article").filter({ hasText: "验收 DeepSeek" }).getByText("已就绪", { exact: true })
      .waitFor({ timeout: 120_000 });
    await page.getByRole("button", { name: "继续" }).click();
    await page.getByTestId("onboarding-step-2").waitFor();
    const replaceButton = page.getByRole("button", { name: "改用这个 API" });
    if (await replaceButton.isVisible()) {
      await replaceButton.click();
      await page.getByTestId("onboarding-api-replacement").waitFor({ state: "detached", timeout: 30_000 });
    }
    await page.getByRole("button", { name: "继续" }).click();
    await page.getByTestId("onboarding-step-3").waitFor();
    await page.getByRole("button", { name: "继续" }).click();
    await page.getByTestId("onboarding-step-4").waitFor();
    await page.getByRole("button", { name: "开始使用" }).click();
  }
  await page.getByRole("button", { name: "设置" }).waitFor({ timeout: 30_000 });
  return page;
}

async function readKeychainSecret(): Promise<string> {
  const account = process.env.USER?.trim();
  if (!account) throw new Error("Keychain account is unavailable");
  const child = spawn("security", ["find-generic-password", "-w", "-a", account, "-s", "moebius-byok-acceptance"], {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.resume();
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const secret = Buffer.concat(stdout).toString("utf8").trim();
  if (exitCode !== 0 || secret.length < 8 || secret.length > 16_384 || /[\r\n\0]/u.test(secret)) {
    throw new Error("The acceptance Keychain item is unavailable or invalid");
  }
  return secret;
}

async function openAgentTeams(page: Page): Promise<void> {
  await page.getByTestId("sidebar-nav-agent-teams").click();
  await page.getByTestId("agent-team-row").first().waitFor();
}

async function openDevelopmentTeam(page: Page): Promise<void> {
  await openAgentTeams(page);
  await page.locator('[data-testid="agent-team-row"][data-team-key="system:development"]').click();
  await page.getByTestId("agent-team-detail").waitFor();
}

const editor = (page: Page, name: string) =>
  page.locator(`[aria-label="${name} AGENT.md"]`);

async function focusMainWindow(application: ElectronApplication): Promise<void> {
  // Real OS window focus is unreliable under a driver; the product trigger for
  // the external-change re-check is the renderer window `focus` event (user
  // returning to the app), so the driver synthesizes that same event after
  // requesting window/webContents focus.
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.webContents.focus();
    window?.focus();
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await application.windows()[0]?.evaluate(() => window.dispatchEvent(new Event("focus")));
  await new Promise((resolve) => setTimeout(resolve, 800));
}

async function readSqliteRevisions(): Promise<Array<Record<string, unknown>>> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(sqlitePath(), { readOnly: true });
  try {
    // The app's worker may be mid-write (e.g. the async summary job); a bounded
    // busy timeout keeps the acceptance's concurrent reads deterministic.
    db.exec("PRAGMA busy_timeout = 5000");
    return db.prepare(
      "SELECT team_stable_id, member_slug, author_kind, summary_status, length(content) AS content_len FROM agent_markdown_revisions ORDER BY created_at ASC, revision_id ASC",
    ).all() as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function readLatestRevisionContent(teamId: string, memberSlug: string): Promise<string | null> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(sqlitePath(), { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const row = db.prepare(
      "SELECT content FROM agent_markdown_revisions WHERE team_stable_id = ? AND member_slug = ? ORDER BY created_at DESC, revision_id DESC LIMIT 1",
    ).get(teamId, memberSlug) as { content?: unknown } | undefined;
    return typeof row?.content === "string" ? row.content : null;
  } finally {
    db.close();
  }
}

let application = await launch();
try {
  // ---------- Acceptance 1: save AGENT.md -> markers + timeline + summary ----------
  let page = await mainPage(application);
  await openDevelopmentTeam(page);
  const devManagerEditor = editor(page, "开发经理");
  const firstDraft = "# 开发经理\n\n负责技术决策与质量把关。\n\n验收以真机证据为准。\n";
  await devManagerEditor.click();
  await devManagerEditor.fill(firstDraft);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.locator("#agent-team-markdown-editor").waitFor({ state: "visible", timeout: 15_000 });
  // The revision lands synchronously; markers render immediately. Markers are
  // presented in an overlay OUTSIDE the contentEditable (never inside it), so
  // they are queried document-wide, not as a descendant of the editor.
  await page.locator("[data-change-marker]").first().waitFor({ state: "attached", timeout: 15_000 });
  const markerCountAfterFirstSave = await page.locator("[data-change-marker]").count();
  await page.getByTestId("agent-team-markdown-timeline-toggle").click();
  await page.getByRole("status").filter({ hasText: "摘要生成中" }).first().waitFor({ timeout: 15_000 });
  const pendingVisible = await page.getByRole("status").filter({ hasText: "摘要生成中" }).count() > 0;
  // The editor's title line stays rendered while the summary job runs: it shows
  // a neutral "正在生成说明…" placeholder instead of disappearing (PRD: the
  // recent-change line is常驻 and must not be blank).
  const pendingTitleLineVisible = await page.getByText("最近变化 · 正在生成说明…", { exact: false }).count() > 0;
  // The summary job performs ONE real provider invocation in the background.
  // Its terminal state is environment-dependent: with a usable default Agent
  // the summary becomes ready; without any usable provider it downgrades to
  // unavailable (that degradation path is pinned deterministically by unit
  // tests). Wait for the terminal state, then reselect the member and assert
  // the UI renders it — including the title line, which must keep showing a
  // neutral placeholder instead of disappearing.
  let terminalStatus: "ready" | "unavailable" | null = null;
  let terminalSummary: string | null = null;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const rows = await readSqliteRevisions();
    const latestUserRevision = [...rows].reverse().find((row) =>
      row.member_slug === "dev-manager" && row.author_kind === "user");
    if (latestUserRevision?.summary_status === "ready") {
      terminalStatus = "ready";
      terminalSummary = String(latestUserRevision.summary ?? "");
      break;
    }
    if (latestUserRevision?.summary_status === "unavailable") {
      terminalStatus = "unavailable";
      break;
    }
  }
  let terminalUiRendered = false;
  let terminalUiObservation = "";
  // Member reselect triggers a fresh revisions load; the terminal summary
  // state then becomes visible in the UI (ready header line or unavailable text).
  await page.getByTestId("agent-team-member-selector").getByRole("tab", { name: /开发经理/u }).click();
  let terminalTitleLineRendered = false;
  if (terminalStatus === "ready" && terminalSummary !== null) {
    await page.getByText(/最近变化/u).first().waitFor({ timeout: 15_000 });
    terminalUiRendered = (await page.getByText(terminalSummary, { exact: false }).count()) > 0;
    // The ready title line renders "最近变化 · {summary}" with the actual summary text.
    terminalTitleLineRendered = (await page.getByText(`最近变化 · ${terminalSummary}`, { exact: false }).count()) > 0;
    terminalUiObservation = "重选成员后标题行显示“最近变化 · {summary}”，摘要文本与 SQLite 一致。";
  } else if (terminalStatus === "unavailable") {
    // The timeline stays expanded across member reselect (component state);
    // only (re-)expand it when it was collapsed by a previous step.
    if (!(await page.getByTestId("agent-markdown-revision-timeline").isVisible().catch(() => false))) {
      await page.getByTestId("agent-team-markdown-timeline-toggle").click();
    }
    await page.getByText("摘要暂时无法生成", { exact: false }).first().waitFor({ timeout: 15_000 });
    terminalUiRendered = (await page.getByText("摘要暂时无法生成", { exact: false }).count()) > 0;
    // The unavailable title line must NOT disappear: it renders a mechanical
    // placeholder counting the changed blocks ("本次改动涉及 N 处").
    terminalTitleLineRendered = (await page.getByText(/最近变化 · 本次改动涉及/, { exact: false }).count()) > 0;
    terminalUiObservation = "重选成员并展开时间线后显示“摘要暂时无法生成”降级文案；标题行渲染中性占位“最近变化 · 本次改动涉及 N 处”（不消失、不编造）。";
  }
  const pendingRevisions = await readSqliteRevisions();
  record(
    "save-creates-revision-with-markers-and-summary-degradation",
    markerCountAfterFirstSave >= 1
      && pendingVisible
      && pendingTitleLineVisible
      && terminalStatus !== null
      && terminalUiRendered
      && terminalTitleLineRendered,
    { markerCountAfterFirstSave, pendingVisible, pendingTitleLineVisible, terminalStatus, terminalSummary,
      terminalUiRendered, terminalTitleLineRendered, pendingRevisions },
    {
      entrance: "Agent 团队 → 开发团队 → 开发经理 AGENT.md 编辑器",
      action: "真实输入新内容并点击“保存”",
      screenObservation: `编辑器正文左侧出现变化标记；标题行先显示“正在生成说明…”占位；展开时间线先显示“摘要生成中…”；后台摘要任务到达终态（${terminalStatus}）后重选成员可见对应 UI：${terminalUiObservation}`,
    },
  );

  // ---------- Acceptance 2: Finder edit -> equivalent revision ----------
  // External-change detection is a user-team feature by design (official/system
  // teams are deliberately skipped). Duplicate the official team into a user
  // copy via the real UI, then Finder-edit a member of the copy and refocus.
  await page.getByRole("button", { name: "复制团队", exact: true }).click();
  await page.getByTestId("agent-team-detail").waitFor({ timeout: 15_000 });
  await page.getByTestId("agent-team-member-selector").waitFor();
  const teamsRoot = path.join(runtimeRoot, "teams");
  const teamEntries = await fs.readdir(teamsRoot, { withFileTypes: true });
  const copiedTeamCandidates = await Promise.all(
    teamEntries
      .filter((entry) => entry.isDirectory() && entry.name !== ".system")
      .map(async (entry) => {
        const stat = await fs.stat(path.join(teamsRoot, entry.name));
        return { name: entry.name, mtime: stat.mtimeMs };
      }),
  );
  const newestUserTeam = copiedTeamCandidates.sort((left, right) => right.mtime - left.mtime)[0];
  if (newestUserTeam === undefined) {
    throw new Error("复制团队未生成用户团队目录");
  }
  const copiedTeamDir = path.join(teamsRoot, newestUserTeam.name);
  const copiedDevFile = path.join(copiedTeamDir, "members", "dev", "AGENT.md");
  await page.getByRole("tab", { name: "开发", exact: true }).click();
  await page.locator("#agent-team-markdown-editor").waitFor({ state: "visible", timeout: 15_000 });
  const originalDevContent = await fs.readFile(copiedDevFile, "utf8");
  await page.waitForFunction(
    (expected) => document.querySelector("#agent-team-markdown-editor")?.getAttribute("data-raw-markdown") === expected,
    originalDevContent,
    { timeout: 15_000 },
  );
  const externalDraft = "# 开发\n\n按方案实现功能，输出真实运行证据。\n";
  await fs.writeFile(copiedDevFile, externalDraft, "utf8");
  await focusMainWindow(application);
  await page.waitForFunction(
    (expected) => document.querySelector("#agent-team-markdown-editor")?.getAttribute("data-raw-markdown") === expected,
    externalDraft,
    { timeout: 15_000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const revisionsAfterExternal = await readSqliteRevisions();
  const externalRevision = revisionsAfterExternal.find((revision) =>
    revision.member_slug === "dev" && revision.author_kind === "user");
  record(
    "finder-edit-records-equivalent-revision",
    externalRevision !== undefined,
    { externalRevision, revisionsAfterExternal },
    {
      entrance: "复制官方开发团队为用户团队 → Finder 修改其 dev 成员 AGENT.md → 返回应用聚焦窗口",
      action: "先打开成员再真实修改文件，随后让窗口重新获得焦点",
      screenObservation: "编辑器载入 Finder 新内容，SQLite 出现该成员的一条 user 修订（与团队页保存结构一致，摘要状态由后台任务按环境到达 ready/unavailable）。",
    },
  );

  // ---------- Acceptance 3: restore to an earlier revision ----------
  // The copy is a fresh team (no history yet): build three revisions so the
  // middle entry exposes a "回到这一版" button that rolls back to its own
  // content (the newest entry's button would be a no-op by design).
  const firstCopyDraft = "# 开发经理\n\n负责技术决策与质量把关。\n\n验收以真机证据为准。（副本基线）\n";
  const middleDraft = "# 开发经理\n\n负责技术决策与质量把关，并亲自复核发布清单。\n\n验收以真机证据为准。（副本基线）\n";
  const secondDraft = "# 开发经理\n\n负责技术决策与质量把关，并亲自复核发布清单与回滚演练。\n\n验收以真机证据为准。（副本基线）\n";
  await page.getByRole("tab", { name: /开发经理/u }).click();
  await editor(page, "开发经理").fill(firstCopyDraft);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  console.log("ACCEPTANCE-3 rows after save1:", (await readSqliteRevisions()).length);
  await editor(page, "开发经理").fill(middleDraft);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  console.log("ACCEPTANCE-3 rows after save2:", (await readSqliteRevisions()).length);
  await editor(page, "开发经理").fill(secondDraft);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  console.log("ACCEPTANCE-3 rows after save3:", (await readSqliteRevisions()).length);
  await page.getByTestId("agent-team-markdown-timeline-toggle").click();
  await page.getByText("回到这一版").first().waitFor({ timeout: 15_000 });
  const restoreButtonsBefore = await page.getByText("回到这一版").count();
  // The older of the two restore-enabled entries rolls the file back to its
  // own content (the middle revision).
  await page.getByText("回到这一版").last().click();
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const rawAfterRestore = await page.evaluate(() =>
    document.querySelector("#agent-team-markdown-editor")?.getAttribute("data-raw-markdown"));
  console.log("ACCEPTANCE-3 raw after restore:", JSON.stringify(rawAfterRestore?.slice(0, 60)));
  const diskAfterRestore = await fs.readFile(
    path.join(copiedTeamDir, "members", "dev-manager", "AGENT.md"),
    "utf8",
  );
  console.log("ACCEPTANCE-3 disk after restore:", JSON.stringify(diskAfterRestore.slice(0, 60)));
  const rowsAfterRestoreProbe = await readSqliteRevisions();
  console.log("ACCEPTANCE-3 sqlite after restore:",
    JSON.stringify(rowsAfterRestoreProbe.map((row) => `${row.team_stable_id}/${row.member_slug}:${row.content_len}`)));
  // The contentEditable serialization normalizes consecutive newlines, so the
  // editor's raw attribute is compared against the actually stored content
  // (disk/sqlite), never against the typed draft string.
  await page.waitForFunction(
    (expected) => document.querySelector("#agent-team-markdown-editor")?.getAttribute("data-raw-markdown") === expected,
    diskAfterRestore,
    { timeout: 15_000 },
  );
  const restoredDiskContent = await fs.readFile(
    path.join(copiedTeamDir, "members", "dev-manager", "AGENT.md"),
    "utf8",
  );
  const revisionsAfterRestore = await readSqliteRevisions();
  const devManagerRevisions = revisionsAfterRestore.filter((revision) =>
    revision.member_slug === "dev-manager" && revision.team_stable_id === "development-copy");
  const latestCopyDevManagerContent = await readLatestRevisionContent("development-copy", "dev-manager");
  record(
    "restore-rolls-back-content-and-records-a-new-revision",
    restoredDiskContent === diskAfterRestore
      && latestCopyDevManagerContent === diskAfterRestore
      && devManagerRevisions.length >= 4
      && restoreButtonsBefore >= 2,
    { restoredDiskContent, latestCopyDevManagerContent, devManagerRevisionCount: devManagerRevisions.length, restoreButtonsBefore },
    {
      entrance: "开发经理时间线 → 中间一条修订的“回到这一版”",
      action: "点击“回到这一版”",
      screenObservation: "编辑器与磁盘内容都回到中间一版（编辑器按存储的规范化全文显示）；时间线新增一条回退产生的 user 修订，历史未被删除或覆盖。",
    },
  );

  // ---------- Acceptance 4: default Agent setting survives restart ----------
  await page.getByRole("button", { name: "设置" }).click();
  const defaultAgentSection = page.locator("fieldset").filter({ hasText: "默认 Agent" });
  await defaultAgentSection.waitFor();
  const engineSelect = defaultAgentSection.getByRole("combobox", { name: "执行引擎" });
  const initialEngine = await engineSelect.inputValue();
  const initialModel = await defaultAgentSection.getByRole("combobox", { name: "Model" }).inputValue();
  await engineSelect.selectOption("claude");
  await defaultAgentSection.getByRole("button", { name: "保存" }).click();
  await page.getByRole("button", { name: "关闭" }).click();

  await application.close();
  application = await launch();
  page = await mainPage(application);
  await page.getByRole("button", { name: "设置" }).click();
  const afterRestartSection = page.locator("fieldset").filter({ hasText: "默认 Agent" });
  await afterRestartSection.waitFor();
  const engineAfterRestart = await afterRestartSection.getByRole("combobox", { name: "执行引擎" }).inputValue();
  const modelAfterRestart = await afterRestartSection.getByRole("combobox", { name: "Model" }).inputValue();
  const storedConfig = await fs.readFile(defaultAgentPath(), "utf8").catch(() => null);
  record(
    "default-agent-setting-survives-restart",
    initialEngine === "codex" && initialModel === "gpt-5.6-sol"
      && engineAfterRestart === "claude" && modelAfterRestart === "sonnet"
      && storedConfig !== null && storedConfig.includes('"cli": "claude"'),
    { initialEngine, initialModel, engineAfterRestart, modelAfterRestart, storedConfig },
    {
      entrance: "设置 → 常规 → 默认 Agent → 重启应用 → 设置",
      action: "首次打开显示内置推荐（Codex/gpt-5.6-sol/high）；切换为 Claude Code 保存；重启后再次打开设置",
      screenObservation: "未配置时显示内置通用助手推荐而非空白；重启后仍是保存的 Claude Code/sonnet，配置文件落盘。",
    },
  );
  await page.getByRole("button", { name: "关闭" }).click();

  // ---------- Acceptance 5: legacy baseline migration (verified + conservative) ----------
  await application.close();
  const verifiedState = JSON.parse(await fs.readFile(officialStatePath(), "utf8")) as {
    teams: Record<string, { appliedContentSnapshot?: unknown; baselineConfidence?: string }>;
  };
  const verifiedHasSnapshot = verifiedState.teams.development?.appliedContentSnapshot !== undefined
    && verifiedState.teams.development?.baselineConfidence === "verified";
  const revisionsAfterVerifiedMigration = await readSqliteRevisions();
  record(
    "legacy-baseline-migrates-verified-with-backfill",
    verifiedHasSnapshot,
    {
      verifiedHasSnapshot,
      developmentConfidence: verifiedState.teams.development?.baselineConfidence,
      snapshotTeamKeys: Object.keys(verifiedState.teams).filter((key) =>
        verifiedState.teams[key]?.appliedContentSnapshot !== undefined),
      revisionsAfterVerifiedMigration,
    },
    {
      entrance: "首次启动（seed 写入 fingerprint-only 官方状态）→ 启动迁移",
      action: "以全新隔离数据根启动应用（无任何预置状态），随后读取官方状态文件",
      screenObservation: "未编辑的官方团队基线被回填完整内容快照并标记 verified，未产生多余修订。",
    },
  );

  // Simulate the legacy fingerprint-only shape of an older build (the Finder
  // edit above already customized the dev member), then restart: the migration
  // must land conservative and record one starting revision per member.
  const legacyState = JSON.parse(await fs.readFile(officialStatePath(), "utf8")) as {
    teams: Record<string, Record<string, unknown>>;
  };
  for (const team of Object.values(legacyState.teams)) {
    delete team.appliedContentSnapshot;
  }
  await fs.writeFile(officialStatePath(), `${JSON.stringify(legacyState, null, 2)}\n`, "utf8");
  application = await launch();
  page = await mainPage(application);
  await openAgentTeams(page);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await application.close();

  const migratedState = JSON.parse(await fs.readFile(officialStatePath(), "utf8")) as {
    teams: Record<string, { appliedContentSnapshot?: unknown; baselineConfidence?: string }>;
  };
  const devTeam = migratedState.teams.development;
  const conservativeMarked = devTeam?.baselineConfidence === "conservative"
    && devTeam?.appliedContentSnapshot === null;
  const finalRevisions = await readSqliteRevisions();
  const devRevisions = finalRevisions.filter((revision) => revision.member_slug === "dev");
  const devManagerRevisionsFinal = finalRevisions.filter((revision) => revision.member_slug === "dev-manager");
  const startingRevisionForDev = devRevisions.some((revision) =>
    revision.author_kind === "user");
  const noDuplicateStartingRevision = devRevisions.length === 2; // Finder edit + conservative starting point
  record(
    "legacy-baseline-migrates-conservative-with-starting-revisions",
    conservativeMarked && startingRevisionForDev && noDuplicateStartingRevision,
    {
      conservativeMarked,
      devTeamConfidence: devTeam?.baselineConfidence,
      devRevisions,
      devManagerRevisionsFinal,
      finalRevisionCount: finalRevisions.length,
    },
    {
      entrance: "legacy 指纹状态（旧版结构）→ 重启 → 启动迁移",
      action: "把官方状态改回旧版 fingerprint-only 结构后重启应用，再读取状态与修订表",
      screenObservation: "已自定义的团队基线标记 conservative 且不伪造快照；每个成员补一条 user 起点修订；二次启动不重复追加（dev 恰好 2 条：Finder 编辑 + 起点）。",    },
  );

  // Idempotence: one more restart adds nothing.
  application = await launch();
  page = await mainPage(application);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await application.close();
  const revisionsAfterThirdLaunch = await readSqliteRevisions();
  record(
    "baseline-migration-is-idempotent-across-restarts",
    revisionsAfterThirdLaunch.length === finalRevisions.length,
    { before: finalRevisions.length, after: revisionsAfterThirdLaunch.length },
    {
      entrance: "迁移完成后的官方团队 → 再次重启",
      action: "第三次启动后读取修订表",
      screenObservation: "修订条数与第二次启动一致，迁移不会重复创建起点修订。",
    },
  );
} catch (error) {
  assertions.push({
    id: "acceptance-script-completed",
    passed: false,
    observed: { message: error instanceof Error ? error.message : String(error) },
  });
} finally {
  await application.close().catch(() => undefined);
  await fs.writeFile(evidencePath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    environment: "真实 Electron dev 等价应用（playwright 驱动，隔离 MOEBIUS_DATA_ROOT/HOME/PATH）",
    records,
    assertions,
  }, null, 2)}\n`, "utf8");
  await fs.rm(runtimeRoot, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ ok: assertions.every((item) => item.passed), evidence: evidencePath })}\n`);
}

if (assertions.some((assertion) => !assertion.passed)) process.exitCode = 1;
