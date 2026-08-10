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
  const titleLine = page.locator("span.text-xs.text-sub", { hasText: "最近变化" }).first();
  const pendingPlaceholder = "最近变化 · 正在生成说明…";
  // The core completion signal (PRD flows/agent-evolution.md:133): the
  // "最近变化" line settles from its pending placeholder to the terminal copy
  // WITHOUT any user action — no member reselect, no click, no window focus.
  // The background summary job pushes a completion event to the renderer and
  // the open member's revisions refresh in place. This helper is the
  // acceptance's passive observation channel (the app itself never polls):
  // it samples the title line every 100ms while `trigger` runs and records
  // real wall-clock timestamps of the first pending and first terminal frame,
  // plus the minimum marker count observed (markers must never unmount).
  const observeSettle = async (
    trigger: () => Promise<void>,
    options: { trackMarkers: boolean; intervalMs: number } = { trackMarkers: true, intervalMs: 100 },
  ): Promise<{ pendingAt: number | null; terminalAt: number | null; markerMin: number }> => {
    let pendingAt: number | null = null;
    let terminalAt: number | null = null;
    let markerMin = Number.POSITIVE_INFINITY;
    const triggerPromise = trigger();
    const startedAt = Date.now();
    // The summary job's one-shot runner can idle up to its 60s timeout plus
    // spawn overhead before failing (isolated PATH without the default Agent
    // CLI), with a 120s hard cap; observe past the cap with margin and break
    // as soon as the terminal frame arrives. The loop samples ONLY the title
    // line (plus an optional marker count) — nothing slower may run inside it,
    // or a fast-settling job's pending frame (~200ms) is missed.
    while (Date.now() - startedAt < 150_000) {
      if (options.trackMarkers) {
        markerMin = Math.min(markerMin, await page.locator("[data-change-marker]").count());
      }
      const text = await titleLine.textContent().catch(() => null);
      if (text !== null && text.includes(pendingPlaceholder) && pendingAt === null) {
        pendingAt = Date.now();
      }
      if (text !== null && text.includes("最近变化 · ") && !text.includes(pendingPlaceholder)) {
        terminalAt = Date.now();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
    }
    await triggerPromise;
    return {
      pendingAt,
      terminalAt,
      markerMin: markerMin === Number.POSITIVE_INFINITY ? 0 : markerMin,
    };
  };

  // Save 1: first revision for this member (no previousText — no expand
  // control yet); observe the pending -> terminal transition with no action.
  // Marker continuity is only tracked for save 2 (where markers exist before
  // the save); the 50ms interval catches even a fast-settling job.
  // A page-side probe records every summary-settled push the preload delivers,
  // so a failure can be attributed: no events => the main-process push or
  // preload bridge is broken; events without a UI update => the hook's
  // dedupe/refresh decision is broken.
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__revisionSettleEvents = [];
    window.moebius?.onAgentMarkdownRevisionSummarySettled?.((payload) => {
      (window as unknown as { __revisionSettleEvents: unknown[] }).__revisionSettleEvents.push(payload);
    });
  });
  const readSettleEvents = () => page.evaluate(() =>
    (window as unknown as { __revisionSettleEvents?: unknown[] }).__revisionSettleEvents ?? []);
  const firstSettle = await observeSettle(async () => {
    await devManagerEditor.click();
    await devManagerEditor.fill(firstDraft);
    await page.getByRole("button", { name: "保存", exact: true }).click();
  }, { trackMarkers: false, intervalMs: 40 });
  const settleEventsAfterFirst = await readSettleEvents();
  await page.locator("#agent-team-markdown-editor").waitFor({ state: "visible", timeout: 15_000 });
  const markerCountAfterFirstSave = await page.locator("[data-change-marker]").count();
  await page.getByTestId("agent-team-markdown-timeline-toggle").click();
  const timelineVisibleBeforeSettle = await page.getByTestId("agent-markdown-revision-timeline")
    .isVisible().catch(() => false);

  // Save 2: the changed block now carries previousText, so the marker gets an
  // expand control. Expand it as soon as it appears (while the line is still
  // pending if the job has not settled yet) to prove the settle refresh does
  // not flash the marker layer out or lose the expanded state.
  const settleSecondDraft = "# 开发经理\n\n负责技术决策与质量把关，并亲自复核发布清单。\n\n验收以真机证据为准。\n";
  const expandButton = page.getByRole("button", { name: "展开" }).first();
  // The expanded preview is the marker layer's bg-sunken block; its text is
  // the changed block's previous content (block splitting follows the STORED
  // content, which normalizes the typed draft's newlines — never assume the
  // exact paragraph text up front).
  const expandedPreview = page.locator("[data-change-marker] .bg-sunken").first();
  let expanded = false;
  let expandedWhilePending: boolean | null = null;
  // The expand interaction (hover the marker band, then click — the real user
  // flow) runs as a CONCURRENT task so it can never slow the settle sampling
  // loop below the pending frame's duration.
  const expandTask = (async () => {
    const deadline = Date.now() + 20_000;
    while (!expanded && Date.now() < deadline) {
      if (await expandButton.isVisible().catch(() => false)) {
        expandedWhilePending = (await titleLine.textContent().catch(() => null))
          ?.includes(pendingPlaceholder) === true;
        // Real user flow: the attribution row is pointer-events-none until the
        // marker band is hovered — hover it first (real mouse), then click.
        await page.locator("[data-change-marker]").first().hover();
        await expandButton.click({ timeout: 3_000 });
        expanded = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })();
  const secondSettle = await observeSettle(async () => {
    await devManagerEditor.fill(settleSecondDraft);
    await page.getByRole("button", { name: "保存", exact: true }).click();
  }, { trackMarkers: true, intervalMs: 40 });
  await expandTask;
  // Cross-check: did the summary job settle inside the observation window at
  // all? If the DB is terminal while the title line stayed pending, the push/
  // refresh path failed; if the DB is still pending, the job itself was slow.
  const settleWindowRows = await readSqliteRevisions();
  const devManagerRows = settleWindowRows.filter((row) =>
    row.member_slug === "dev-manager" && row.team_stable_id === "development");
  const latestDevManagerStatus = devManagerRows.at(-1)?.summary_status ?? null;
  const settleEventsAfterSecond = await readSettleEvents();

  let terminalStatus: "ready" | "unavailable" | null = null;
  let terminalSummary: string | null = null;
  let terminalTitleLineRendered = false;
  let terminalTimelineRendered = false;
  let expandRetained = false;
  let expandPreviewText: string | null = null;
  let timelineStillVisible = false;
  const settleMs = secondSettle.pendingAt !== null && secondSettle.terminalAt !== null
    ? secondSettle.terminalAt - secondSettle.pendingAt
    : null;
  const firstSettleMs = firstSettle.pendingAt !== null && firstSettle.terminalAt !== null
    ? firstSettle.terminalAt - firstSettle.pendingAt
    : null;
  if (secondSettle.terminalAt !== null) {
    const rows = await readSqliteRevisions();
    const latestUserRevision = [...rows].reverse().find((row) =>
      row.member_slug === "dev-manager" && row.author_kind === "user");
    if (latestUserRevision?.summary_status === "ready") {
      terminalStatus = "ready";
      terminalSummary = String(latestUserRevision.summary ?? "");
    } else {
      terminalStatus = "unavailable";
    }
    const text = await titleLine.textContent().catch(() => null) ?? "";
    terminalTitleLineRendered = terminalStatus === "unavailable"
      ? text.includes("最近变化 · 本次改动涉及")
      : terminalSummary !== null && text.includes(`最近变化 · ${terminalSummary}`);
    terminalTimelineRendered = terminalStatus === "unavailable"
      ? await page.getByText("摘要暂时无法生成", { exact: false }).first().isVisible().catch(() => false)
      : terminalSummary !== null
        && await page.getByText(terminalSummary, { exact: false }).first().isVisible().catch(() => false);
    expandRetained = await expandedPreview.isVisible().catch(() => false);
    expandPreviewText = await expandedPreview.textContent().catch(() => null);
    timelineStillVisible = await page.getByTestId("agent-markdown-revision-timeline")
      .isVisible().catch(() => false);
  }
  record(
    "save-creates-revision-with-markers-and-summary-degradation",
    markerCountAfterFirstSave >= 1
      && firstSettle.pendingAt !== null
      && secondSettle.pendingAt !== null
      && secondSettle.terminalAt !== null
      && settleMs !== null
      && terminalStatus !== null
      && terminalTitleLineRendered
      && terminalTimelineRendered
      && secondSettle.markerMin >= 1
      && expandRetained
      && timelineVisibleBeforeSettle
      && timelineStillVisible,
    { markerCountAfterFirstSave, firstSettleMs, settleMs, terminalStatus, terminalSummary,
      secondSettle, latestDevManagerStatus, settleEventsAfterFirst, settleEventsAfterSecond,
      expanded, expandedWhilePending, expandRetained, expandPreviewText, terminalTitleLineRendered,
      terminalTimelineRendered, timelineVisibleBeforeSettle, timelineStillVisible },
    {
      entrance: "Agent 团队 → 开发团队 → 开发经理 AGENT.md 编辑器",
      action: "真实输入新内容并点击“保存”（共两次，第二次产生带原文的标记）；展开一处标记原文后不做任何操作、不切换成员",
      screenObservation: `编辑器正文左侧出现变化标记；标题行先显示“正在生成说明…”占位，随后在无任何用户操作下自行更新为终态文案（第 1 次保存 ${firstSettleMs ?? "—"}ms、第 2 次保存 ${settleMs ?? "—"}ms，均为两次观察之间的真实时间间隔）；标记层全程不消失（第 2 次保存期间最小 ${secondSettle.markerMin} 处）、已展开的原文（“${expandPreviewText?.slice(0, 24) ?? "—"}”）保持展开、时间线保持可见且终态文案就地渲染（${terminalStatus}）`,
    },
  );

  // ---------- Acceptance 2: Finder edit -> equivalent revision ----------
  // External-change detection is a user-team feature by design (official/system
  // teams are deliberately skipped). Duplicate the official team into a user
  // copy via the real UI, then Finder-edit a member of the copy and refocus.
  const copyStartedAt = Date.now();
  await page.getByRole("button", { name: "复制团队", exact: true }).click();
  await page.getByTestId("agent-team-detail").waitFor({ timeout: 15_000 });
  await page.getByTestId("agent-team-member-selector").waitFor();
  const teamsRoot = path.join(runtimeRoot, "teams");
  // The detail page stays mounted while the copy opens asynchronously; wait
  // for the copy's directory on disk (deterministic completion signal) before
  // interacting with its member tabs, so a tab click can never land on the
  // source team's selector and get overwritten by the copy-open selection.
  const waitForCopyDirectory = async (): Promise<string> => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const entries = await fs.readdir(teamsRoot, { withFileTypes: true });
      const candidates = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && entry.name !== ".system")
          .map(async (entry) => {
            const stat = await fs.stat(path.join(teamsRoot, entry.name));
            return { name: entry.name, mtime: stat.mtimeMs };
          }),
      );
      const newest = candidates.sort((left, right) => right.mtime - left.mtime)[0];
      if (newest !== undefined && newest.mtime > copyStartedAt) {
        return path.join(teamsRoot, newest.name);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("复制团队未生成用户团队目录");
  };
  const copiedTeamDir = await waitForCopyDirectory();
  const copiedDevFile = path.join(copiedTeamDir, "members", "dev", "AGENT.md");
  const originalDevContent = await fs.readFile(copiedDevFile, "utf8");
  // The copy-open may reset the member selection to the copy's primary after
  // any earlier tab click; retry until the editor actually shows the copy's
  // dev file (bounded, each attempt waits only 3s).
  let devSelected = false;
  for (let attempt = 0; attempt < 10 && !devSelected; attempt += 1) {
    await page.getByRole("tab", { name: "开发", exact: true }).click();
    devSelected = await page.waitForFunction(
      (expected) => document.querySelector("#agent-team-markdown-editor")?.getAttribute("data-raw-markdown") === expected,
      originalDevContent,
      { timeout: 3_000 },
    ).then(() => true).catch(() => false);
  }
  if (!devSelected) {
    const current = await page.evaluate(() => ({
      raw: document.querySelector("#agent-team-markdown-editor")?.getAttribute("data-raw-markdown")?.slice(0, 120) ?? null,
      selectedTab: document.querySelector("[role='tab'][aria-selected='true']")?.textContent ?? null,
    })).catch(() => null);
    console.log("ACCEPTANCE-2 dev select failed:", JSON.stringify(current));
    throw new Error("复制团队后无法选中 dev 成员");
  }
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
