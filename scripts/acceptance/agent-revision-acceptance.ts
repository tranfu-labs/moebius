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

const editor = (page: Page, displayName: string) =>
  page.locator(`[aria-label="${displayName} 的职责说明"]`);

/**
 * The detail now reads the member body by default; editing is an explicit
 * second step (hover the body's top-right "编辑" button). The change markers
 * and the `data-raw-markdown` attribute only exist in edit mode, so every
 * fill/read below enters edit mode first. Idempotent: "完成编辑" means we are
 * already editing.
 */
async function enterEdit(page: Page): Promise<void> {
  const doneButton = page.getByRole("button", { name: "完成编辑" });
  if (await doneButton.isVisible().catch(() => false)) {
    return;
  }
  const editButton = page.getByRole("button", { name: "编辑" });
  await editButton.click();
  await page.locator("#agent-team-markdown-editor[contenteditable='true']").waitFor({ state: "visible", timeout: 10_000 });
}

async function editorRawMarkdown(page: Page): Promise<string | null> {
  return page.evaluate(() =>
    document.querySelector("#agent-team-markdown-editor")?.getAttribute("data-raw-markdown") ?? null);
}

/** Enters edit mode and waits until the editor shows the expected raw body. */
async function waitForEditorRaw(page: Page, expected: string, timeout = 15_000): Promise<void> {
  await enterEdit(page);
  await page.waitForFunction(
    (value) => document.querySelector("#agent-team-markdown-editor")?.getAttribute("data-raw-markdown") === value,
    expected,
    { timeout },
  );
}

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
  // the open member's revisions refresh in place. The SAME line is rendered a
  // second time next to the save button (product-review blocker 3: the header
  // line sits above the editor and is out of viewport while the user stays at
  // the bottom), and it must settle in place there too. This helper is the
  // acceptance's passive observation channel (the app itself never polls):
  // it samples the title line and the save-row status every 100ms while
  // `trigger` runs and records real wall-clock timestamps of the first pending
  // and first terminal frame, plus the minimum marker count observed (markers
  // must never unmount).
  const saveRowStatus = page.locator("[data-testid='agent-team-markdown-summary-status']");
  const timelineEntries = page.locator("[data-testid='agent-markdown-revision-timeline'] li");
  const observeSettle = async (
    trigger: () => Promise<void>,
    options: {
      trackMarkers: boolean;
      intervalMs: number;
      /**
       * Terminal detection. "any-terminal" fires on the first non-pending line
       * (the line did not exist before). "timeline-entries" fires once the
       * expanded timeline shows at least `count` entries AND both lines are
       * non-pending (later saves): consecutive saves can carry the SAME
       * mechanical summary text, so a text-change heuristic cannot distinguish
       * them — the timeline entry count is the deterministic commit signal for
       * the new revision's state. "settle-event" fires once the page-side
       * probe recorded at least `minEvents` summary-settled pushes AND both
       * lines are non-pending (the first save: the job's duration is
       * environment-dependent — minutes are possible — so the event, not a
       * wall-clock guess, marks the terminal window).
       */
      terminalSignal:
        | { kind: "any-terminal" }
        | { kind: "timeline-entries"; count: number }
        | { kind: "settle-event"; minEvents: number };
    },
  ): Promise<{
    pendingAt: number | null;
    terminalAt: number | null;
    markerMin: number;
    saveRowPendingAt: number | null;
    saveRowTerminalAt: number | null;
  }> => {
    let pendingAt: number | null = null;
    let terminalAt: number | null = null;
    let saveRowPendingAt: number | null = null;
    let saveRowTerminalAt: number | null = null;
    let markerMin = Number.POSITIVE_INFINITY;
    const triggerPromise = trigger();
    const startedAt = Date.now();
    // The summary job's one-shot runner may fail fast (isolated PATH without
    // the default Agent CLI) or idle up to its 60s timeout plus spawn
    // overhead; observe past the cap with margin and break as soon as the
    // terminal frame arrives. The loop samples ONLY the title line, the
    // save-row status, the timeline entry count and an optional marker
    // count — nothing slower may run inside it, or a fast-settling job's
    // pending frame (~200ms) is missed.
    while (Date.now() - startedAt < 150_000) {
      if (options.trackMarkers) {
        markerMin = Math.min(markerMin, await page.locator("[data-change-marker]").count());
      }
      const text = await titleLine.textContent({ timeout: 250 }).catch(() => null);
      if (text !== null && text.includes(pendingPlaceholder) && pendingAt === null) {
        pendingAt = Date.now();
      }
      const saveRowText = await saveRowStatus.textContent({ timeout: 250 }).catch(() => null);
      if (saveRowText !== null && saveRowText.includes(pendingPlaceholder) && saveRowPendingAt === null) {
        saveRowPendingAt = Date.now();
      }
      const nonPending = (value: string | null): boolean =>
        value !== null && value.includes("最近变化 · ") && !value.includes(pendingPlaceholder);
      let committed = true;
      if (options.terminalSignal.kind === "timeline-entries") {
        const entries = await timelineEntries.count().catch(() => 0);
        committed = entries >= options.terminalSignal.count;
      } else if (options.terminalSignal.kind === "settle-event") {
        const events = await readSettleEvents();
        committed = events.length >= options.terminalSignal.minEvents;
      }
      if (committed && nonPending(text) && terminalAt === null) {
        terminalAt = Date.now();
      }
      if (committed && nonPending(saveRowText) && saveRowTerminalAt === null) {
        saveRowTerminalAt = Date.now();
      }
      if (terminalAt !== null && saveRowTerminalAt !== null) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
    }
    await triggerPromise;
    return {
      pendingAt,
      terminalAt,
      markerMin: markerMin === Number.POSITIVE_INFINITY ? 0 : markerMin,
      saveRowPendingAt,
      saveRowTerminalAt,
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
    await enterEdit(page);
    await devManagerEditor.fill(firstDraft);
    await page.getByRole("button", { name: "保存", exact: true }).click();
  }, { trackMarkers: false, intervalMs: 40, terminalSignal: { kind: "settle-event", minEvents: 1 } });
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
  // The lines already carry save 1's terminal copy when save 2 starts, and a
  // fast-settling job can make save 2's terminal text identical to save 1's
  // (same mechanical count). The commit signal for save 2 is therefore the
  // expanded timeline showing TWO entries (save 1 + save 2) with both lines
  // non-pending — not a text change.
  let expanded = false;
  let expandedWhilePending: boolean | null = null;
  // The expand interaction (hover the marker band, then click — the real user
  // flow) runs as a CONCURRENT task so it can never slow the settle sampling
  // loop below the pending frame's duration. The button now exists as soon as
  // the FIRST save commits (its changed block carries previousText), so the
  // gesture races the second save's marker-layer re-render: a marker replaced
  // mid-gesture loses its hover, and the row is pointer-events-none until the
  // 12px rail is hovered again — a real user simply slides back and clicks
  // again, so the acceptance retries the hover-then-click PAIR on the marker
  // that owns the button.
  const expandTask = (async () => {
    const deadline = Date.now() + 30_000;
    while (!expanded && Date.now() < deadline) {
      if (await expandButton.isVisible().catch(() => false)) {
        expandedWhilePending = (await titleLine.textContent().catch(() => null))
          ?.includes(pendingPlaceholder) === true;
        const owningMarker = page.locator("[data-change-marker]")
          .filter({ has: page.getByRole("button", { name: "展开" }) })
          .first();
        try {
          await owningMarker.hover({ timeout: 1_000 });
          await expandButton.click({ timeout: 2_000 });
          expanded = true;
          break;
        } catch {
          // The layer was replaced mid-gesture (or the row had not revealed
          // yet); slide back to the rail and retry the pair.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })();
  const secondSettle = await observeSettle(async () => {
    await enterEdit(page);
    await devManagerEditor.fill(settleSecondDraft);
    await page.getByRole("button", { name: "保存", exact: true }).click();
  }, { trackMarkers: true, intervalMs: 40, terminalSignal: { kind: "timeline-entries", count: 2 } });
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
  let terminalDiagnostics: unknown = null;
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
    // First-save baseline (product-review blocker 1): the member already had
    // persisted content, so the FIRST save's markers only cover the changed
    // block + the inserted block — exactly 2 — and the mechanical summary
    // reports exactly that count, never the whole document. SAVE 2 changes
    // only the first block; the second block carries save 1's marker forward
    // (with its own previousText), so the count stays 2 — equal to the marker
    // bands the user sees, and never inflated by the editor serialization's
    // trailing empty block (which the plan skips).
    terminalTitleLineRendered = terminalStatus === "unavailable"
      ? text.includes("最近变化 · 本次改动涉及 2 处")
      : terminalSummary !== null && text.includes(`最近变化 · ${terminalSummary}`);
    terminalTimelineRendered = terminalStatus === "unavailable"
      ? await page.getByText("摘要暂时无法生成", { exact: false }).first().isVisible().catch(() => false)
      : terminalSummary !== null
        && await page.getByText(terminalSummary, { exact: false }).first().isVisible().catch(() => false);
    expandRetained = await expandedPreview.isVisible().catch(() => false);
    expandPreviewText = await expandedPreview.textContent().catch(() => null);
    timelineStillVisible = await page.getByTestId("agent-markdown-revision-timeline")
      .isVisible().catch(() => false);
  } else {
    // The terminal frame was never observed: snapshot the real page state so a
    // failure can be attributed (stale revision data vs. a remounted detail vs.
    // a hidden/closed view) instead of guessing.
    terminalDiagnostics = await page.evaluate(() => {
      const toggle = document.querySelector("[data-testid='agent-team-markdown-timeline-toggle']");
      return {
        titleLines: [...document.querySelectorAll("span.text-xs.text-sub")]
          .map((element) => element.textContent)
          .filter((text): text is string => text !== null && text.includes("最近变化")),
        markerCount: document.querySelectorAll("[data-change-marker]").length,
        toggleExists: toggle !== null,
        toggleExpanded: toggle?.getAttribute("aria-expanded") ?? null,
        timelineVisible: document.querySelector("[data-testid='agent-markdown-revision-timeline']") !== null,
        detailVisible: document.querySelector("[data-testid='agent-team-detail']") !== null,
        bodyStart: document.body.innerText.slice(0, 600),
      };
    }).catch(() => null);
  }
  record(
    "save-creates-revision-with-markers-and-summary-degradation",
    markerCountAfterFirstSave === 2
      // The completion signal (flows/agent-evolution.md:133): the line settles
      // to THIS save's terminal copy with no user action. The first save's
      // job duration is environment-dependent (minutes are possible), so the
      // first observation accepts a pending frame OR the terminal frame; the
      // second save's signals are the hard in-place-settle requirements. The
      // pending frame itself is transient — a fast-settling job can reach
      // terminal before the save refresh commits — so pending observations
      // are recorded but not required.
      && (firstSettle.pendingAt !== null || firstSettle.terminalAt !== null)
      && secondSettle.terminalAt !== null
      && secondSettle.saveRowTerminalAt !== null
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
      terminalTimelineRendered, timelineVisibleBeforeSettle, timelineStillVisible, terminalDiagnostics },
    {
      entrance: "Agent 团队 → 开发团队 → 开发经理 AGENT.md 编辑器",
      action: "真实输入新内容并点击“保存”（共两次，第二次产生带原文的标记）；展开一处标记原文后不做任何操作、不切换成员",
      screenObservation: `首次保存只在实际变化的段落上出现变化标记（${markerCountAfterFirstSave} 处，未变化段落无标记——以写前磁盘内容为基线）；编辑器标题行与保存按钮旁的同一摘要行先显示“正在生成说明…”占位，随后在无任何用户操作下自行更新为终态文案（第 1 次保存 ${firstSettleMs ?? "—"}ms、第 2 次保存 ${settleMs ?? "—"}ms，均为两次观察之间的真实时间间隔；保存行终态在 ${secondSettle.saveRowTerminalAt !== null && secondSettle.saveRowPendingAt !== null ? secondSettle.saveRowTerminalAt - secondSettle.saveRowPendingAt : "—"}ms 内就位）；标记层全程不消失（第 2 次保存期间最小 ${secondSettle.markerMin} 处）、已展开的原文（“${expandPreviewText?.slice(0, 24) ?? "—"}”）保持展开、时间线保持可见且终态文案就地渲染（${terminalStatus}）`,
    },
  );

  // ---------- Acceptance 2a: Finder edit on an OFFICIAL team records a revision ----------
  // External-change detection now covers official-source teams too
  // (product-review blocker 2: the reviewer's walk-through found a Finder
  // edit on the built-in team silently ignored, while PRD requires the same
  // revision structure for every team). Open the official team's qa member,
  // edit its AGENT.md in Finder, refocus, and verify the revision exists —
  // and that it was persisted BEFORE the reload (the main process awaits the
  // revision write before answering `changed`).
  await page.getByRole("tab", { name: "软件测试", exact: true }).click();
  const officialQaFile = path.join(developmentDirectory(), "members", "qa", "AGENT.md");
  const officialQaOriginal = await fs.readFile(officialQaFile, "utf8");
  await waitForEditorRaw(page, officialQaOriginal);
  const officialQaDraft = "# 测试\n\n设计测试方案，对抗性审查每个交付。\n\n验收记录必须包含真实运行步骤。\n";
  await fs.writeFile(officialQaFile, officialQaDraft, "utf8");
  await focusMainWindow(application);
  await waitForEditorRaw(page, officialQaDraft);
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const revisionsAfterOfficialExternal = await readSqliteRevisions();
  const officialQaRevision = revisionsAfterOfficialExternal.find((revision) =>
    revision.team_stable_id === "development" && revision.member_slug === "qa" && revision.author_kind === "user");
  record(
    "official-team-finder-edit-records-equivalent-revision",
    officialQaRevision !== undefined,
    { officialQaRevision, revisionsAfterOfficialExternal },
    {
      entrance: "官方开发团队 → 测试成员 AGENT.md → Finder 直接修改 → 返回应用聚焦窗口",
      action: "先打开官方团队的 qa 成员，真实修改其 AGENT.md 文件，随后让窗口重新获得焦点",
      screenObservation: "编辑器载入 Finder 新内容，SQLite 出现官方团队该成员的一条 user 修订，与团队页保存结构一致；成员历史随即就地刷新。",
    },
  );

  // ---------- Acceptance 2b: Finder edit on a USER team records a revision ----------
  // The recorded-location path (user teams) keeps working. Duplicate the
  // official team into a user copy via the real UI, then Finder-edit a member
  // of the copy and refocus.
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
    ).then(() => true).catch(async () => {
      // The copy-open may reset the member selection; re-enter edit mode on retry.
      await enterEdit(page).catch(() => undefined);
      return false;
    });
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
  await waitForEditorRaw(page, externalDraft);
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
  // The copy is a fresh team (no history yet): build three revisions. The
  // current (newest) entry must NOT offer a restore action; EVERY historical
  // revision — including the earliest — must (product-review blocker 4).
  // Clicking the middle entry rolls back to its own content and records the
  // restore as a NEW revision; the count then stays stable (no self-excitation
  // loop re-recording revisions on every external check).
  const firstCopyDraft = "# 开发经理\n\n负责技术决策与质量把关。\n\n验收以真机证据为准。（副本基线）\n";
  const middleDraft = "# 开发经理\n\n负责技术决策与质量把关，并亲自复核发布清单。\n\n验收以真机证据为准。（副本基线）\n";
  const secondDraft = "# 开发经理\n\n负责技术决策与质量把关，并亲自复核发布清单与回滚演练。\n\n验收以真机证据为准。（副本基线）\n";
  await page.getByRole("tab", { name: /开发经理/u }).click();
  await enterEdit(page);
  await editor(page, "开发经理").fill(firstCopyDraft);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  console.log("ACCEPTANCE-3 rows after save1:", (await readSqliteRevisions()).length);
  await enterEdit(page);
  await editor(page, "开发经理").fill(middleDraft);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  console.log("ACCEPTANCE-3 rows after save2:", (await readSqliteRevisions()).length);
  await enterEdit(page);
  await editor(page, "开发经理").fill(secondDraft);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  console.log("ACCEPTANCE-3 rows after save3:", (await readSqliteRevisions()).length);
  await page.getByTestId("agent-team-markdown-timeline-toggle").click();
  await page.getByText("回到这一版").first().waitFor({ timeout: 15_000 });
  const restoreButtonsBefore = await page.getByText("回到这一版").count();
  // The NEWEST timeline entry (first li) must NOT offer a restore action —
  // restoring the current version would be a no-op that fabricates a
  // duplicate revision.
  const newestEntryRestoreButtons = await page
    .locator("[data-testid='agent-team-markdown-revision-timeline'] li").first()
    .getByText("回到这一版").count();
  // The FIRST restore-enabled entry is the middle revision (newest-first
  // order); it rolls the file back to its own content.
  await page.getByText("回到这一版").first().click();
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await enterEdit(page);
  const rawAfterRestore = await editorRawMarkdown(page);
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
  await waitForEditorRaw(page, diskAfterRestore);
  const restoredDiskContent = await fs.readFile(
    path.join(copiedTeamDir, "members", "dev-manager", "AGENT.md"),
    "utf8",
  );
  const revisionsAfterRestore = await readSqliteRevisions();
  const devManagerRevisions = revisionsAfterRestore.filter((revision) =>
    revision.member_slug === "dev-manager" && revision.team_stable_id === "development-copy");
  const latestCopyDevManagerContent = await readLatestRevisionContent("development-copy", "dev-manager");
  // Self-excitation guard (the 655b940b lesson): after the restore settles,
  // the revision count must stay flat — an external check or effect loop that
  // re-records revisions would keep growing it.
  const revisionsAfterRestoreStable = await readSqliteRevisions();
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const revisionsAfterRestoreStable2 = await readSqliteRevisions();
  record(
    "restore-rolls-back-content-and-records-a-new-revision",
    restoredDiskContent === diskAfterRestore
      && latestCopyDevManagerContent === diskAfterRestore
      && devManagerRevisions.length >= 4
      && restoreButtonsBefore >= 2
      && newestEntryRestoreButtons === 0
      && revisionsAfterRestoreStable2.length === revisionsAfterRestoreStable.length,
    { restoredDiskContent, latestCopyDevManagerContent, devManagerRevisionCount: devManagerRevisions.length,
      restoreButtonsBefore, newestEntryRestoreButtons,
      revisionsBeforeStabilityWindow: revisionsAfterRestoreStable.length,
      revisionsAfterStabilityWindow: revisionsAfterRestoreStable2.length },
    {
      entrance: "开发经理时间线 → 中间一条修订的“回到这一版”",
      action: "点击“回到这一版”（最新一条无此入口，最早一条也有）",
      screenObservation: "编辑器与磁盘内容都回到中间一版（编辑器按存储的规范化全文显示）；时间线新增一条回退产生的 user 修订，历史未被删除或覆盖；最新（当前）版本没有“回到这一版”按钮；回退后持续观察 3 秒修订数不再增长。",
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
  // Team-aware counts: the official-team Finder edit (acceptance 2a) already
  // gave development/qa one user revision, so the conservative migration must
  // SKIP the starting revision for qa and create exactly one for members with
  // no history (dev). Re-running must not duplicate either.
  const developmentDevRevisions = finalRevisions.filter((revision) =>
    revision.team_stable_id === "development" && revision.member_slug === "dev");
  const developmentQaRevisions = finalRevisions.filter((revision) =>
    revision.team_stable_id === "development" && revision.member_slug === "qa");
  const developmentDevManagerRevisions = finalRevisions.filter((revision) =>
    revision.team_stable_id === "development" && revision.member_slug === "dev-manager");
  const startingRevisionForDev = developmentDevRevisions.some((revision) =>
    revision.author_kind === "user");
  const noDuplicateStartingRevision = developmentDevRevisions.length === 1
    && developmentQaRevisions.length === 1;
  record(
    "legacy-baseline-migrates-conservative-with-starting-revisions",
    conservativeMarked && startingRevisionForDev && noDuplicateStartingRevision,
    {
      conservativeMarked,
      devTeamConfidence: devTeam?.baselineConfidence,
      developmentDevRevisions,
      developmentQaRevisions,
      developmentDevManagerRevisions,
      finalRevisionCount: finalRevisions.length,
    },
    {
      entrance: "legacy 指纹状态（旧版结构）→ 重启 → 启动迁移",
      action: "把官方状态改回旧版 fingerprint-only 结构后重启应用，再读取状态与修订表",
      screenObservation: "已自定义的团队基线标记 conservative 且不伪造快照；无历史成员各补一条 user 起点修订（dev 恰好 1 条），已有修订的成员（qa 的 Finder 编辑、dev-manager 的保存）不重复追加；二次启动不重复。",    },
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
