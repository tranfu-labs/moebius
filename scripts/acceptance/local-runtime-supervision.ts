import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";

import type {
  LocalConsoleMessage,
  LocalConsoleRunSnapshot,
  LocalConsoleStateSnapshot,
} from "../../src/local-console/types.js";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

interface SessionSummary {
  sessionId: string;
  title: string;
}

interface ProviderInvocation {
  provider: "kimi" | "codex";
  mode: "full" | "resume";
  marker: string;
  externalSessionId: string | null;
  recordedAt: string;
}

interface Evidence {
  generatedAt: string;
  entry: string;
  runtimeRoot: string;
  assertions: Array<{ id: string; passed: boolean; observed: unknown }>;
  scenarios: Record<string, unknown>;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(projectRoot, "desktop");
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-runtime-supervision-"));
const fakeBin = path.join(runtimeRoot, "bin");
const codexHome = path.join(runtimeRoot, "codex-home");
const providerLog = path.join(runtimeRoot, "provider-invocations.jsonl");
const evidenceRoot = await createAcceptanceOutputDirectory("local-runtime-supervision");
const evidencePath = path.join(evidenceRoot, "evidence.json");
const assertions: Evidence["assertions"] = [];
const scenarios: Record<string, unknown> = {};
let desktop: Awaited<ReturnType<typeof launchDesktop>> | null = null;
let completed = false;

await Promise.all([
  fs.mkdir(path.join(runtimeRoot, ".state"), { recursive: true }),
  fs.mkdir(fakeBin, { recursive: true }),
  fs.mkdir(codexHome, { recursive: true }),
]);
await fs.writeFile(path.join(runtimeRoot, ".onboarding-completed"), `${new Date().toISOString()}\n`, "utf8");
await fs.writeFile(providerLog, "", "utf8");
await fs.writeFile(path.join(fakeBin, "kimi"), kimiShimSource(), { encoding: "utf8", mode: 0o755 });
await fs.writeFile(path.join(fakeBin, "codex"), codexShimSource(), { encoding: "utf8", mode: 0o755 });

try {
  desktop = await launchDesktop();
  const team = await createKimiTeam(desktop.page);

  const interrupted = await createSession(desktop.apiBase, team.teamId, "Kimi 中断保留内容");
  await openSession(desktop.page, interrupted);
  await sendMessage(desktop.page, "PARTIAL_STOP");
  const interruptedActive = await waitForState(desktop.apiBase, interrupted.sessionId, (state) =>
    state.activeRuns.find((run) => run.liveMarkdown?.includes("中断前已经产出的正文") === true) ?? null);
  await desktop.page.getByText("中断前已经产出的正文").waitFor();
  assertEvidence("A1-live-partial-visible", await desktop.page.getByText("中断前已经产出的正文").isVisible(), {
    runId: interruptedActive.runId,
    liveMarkdown: interruptedActive.liveMarkdown,
  });
  await desktop.page.getByRole("button", { name: "停下主理人" }).click();
  const interruptedTerminal = await waitForTerminal(
    desktop.apiBase,
    interrupted.sessionId,
    interruptedActive.runId,
    "interrupted",
  );
  const interruptionInvocations = await waitFor(async () => {
    const entries = await readProviderInvocations();
    return entries.some((entry) => entry.provider === "kimi" && entry.marker === "SIGINT")
      ? entries
      : null;
  });
  await desktop.page.getByText("你让这一步停下了", { exact: true }).waitFor();
  assertEvidence(
    "A1-user-stop-is-neutral",
    await desktop.page.getByText("你让这一步停下了", { exact: true }).isVisible()
      && await desktop.page.getByText("这一步没跑起来").count() === 0
      && interruptionInvocations.some((entry) =>
        entry.provider === "kimi"
        && entry.marker === "SIGINT"
        && entry.externalSessionId !== null),
    { terminal: terminalEvidence(interruptedTerminal), providerInvocations: interruptionInvocations },
  );
  assertEvidence(
    "A6-partial-content-preserved",
    await desktop.page.getByText("中断前已经产出的正文").isVisible()
      && await desktop.page.getByText("内容不完整").isVisible(),
    terminalEvidence(interruptedTerminal),
  );

  await desktop.application.close();
  desktop = await launchDesktop();
  await openSession(desktop.page, interrupted);
  await desktop.page.getByText("你让这一步停下了", { exact: true }).waitFor();
  assertEvidence(
    "A6-terminal-survives-restart",
    await desktop.page.getByText("中断前已经产出的正文").isVisible()
      && await desktop.page.getByText("内容不完整").isVisible(),
    { sessionId: interrupted.sessionId, runId: interruptedActive.runId },
  );

  const empty = await createSession(desktop.apiBase, team.teamId, "Kimi 空结果");
  await openSession(desktop.page, empty);
  await sendMessage(desktop.page, "EMPTY_RESULT");
  const emptyTerminal = await waitForAnyTerminal(desktop.apiBase, empty.sessionId);
  await desktop.page.getByText("这一步没有产出完整结果").waitFor();
  const emptyState = await getState(desktop.apiBase, empty.sessionId);
  const emptySidebarRow = desktop.page.locator(
    `[data-testid="conversation-sidebar-session"][data-session-id="${empty.sessionId}"]`,
  );
  await waitFor(async () =>
    await emptySidebarRow.getAttribute("data-status-dot") === "red" ? true : null);
  assertEvidence(
    "A2-empty-end-turn-is-not-success",
    emptyTerminal.terminal?.kind === "crashed"
      && emptyTerminal.terminal.safeCode === "kimi-empty-response"
      && emptyTerminal.body.includes("终端直接运行 kimi")
      && !emptyTerminal.body.includes("额度")
      && !emptyTerminal.body.includes("服务问题")
      && !emptyState.messages.some((message) => message.speaker === "agent")
      && await emptySidebarRow.getAttribute("data-status-dot") === "red",
    {
      terminal: terminalEvidence(emptyTerminal),
      safeBody: emptyTerminal.body,
      agentMessages: emptyState.messages.filter((message) => message.speaker === "agent"),
      sidebarStatusDot: await emptySidebarRow.getAttribute("data-status-dot"),
    },
  );

  const quota = await createSession(desktop.apiBase, team.teamId, "Kimi 额度与单次重跑");
  await openSession(desktop.page, quota);
  await sendMessage(desktop.page, "QUOTA_CONFIRMED");
  const quotaTerminal = await waitForAnyTerminal(desktop.apiBase, quota.sessionId);
  await desktop.page.getByText("当前额度不可用").waitFor();
  assertEvidence(
    "A12-confirmed-quota-speaks-precisely",
    quotaTerminal.terminal?.kind === "quota-exhausted"
      && quotaTerminal.terminal.retryable === false
      && quotaTerminal.body.includes("已确认当前账户的推理额度不可用"),
    terminalEvidence(quotaTerminal),
  );

  await desktop.page.getByRole("button", { name: "换执行配置重跑" }).click();
  await desktop.page.getByLabel("CLI").selectOption("codex");
  const selectedOverride = {
    cli: await desktop.page.getByLabel("CLI").inputValue(),
    model: await desktop.page.getByLabel("Model").inputValue(),
    effort: await desktop.page.getByLabel("思考程度").inputValue(),
  };
  await desktop.page.getByRole("button", { name: "仅本次重跑" }).click();
  await desktop.page.getByText("CODEX_OVERRIDE_SUCCESS").waitFor();
  const overrideState = await getState(desktop.apiBase, quota.sessionId);
  const overrideReply = overrideState.messages.find((message) =>
    message.speaker === "agent" && message.body === "CODEX_OVERRIDE_SUCCESS");
  assertEvidence(
    "A7-override-rerun-completes-in-place",
    selectedOverride.cli === "codex"
      && await desktop.page.getByText("CODEX_OVERRIDE_SUCCESS").isVisible()
      && overrideReply?.runTiming?.stepId === quotaTerminal.runTiming?.stepId
      && overrideReply.runTiming?.attempt === (quotaTerminal.runTiming?.attempt ?? 0) + 1,
    {
      sessionId: quota.sessionId,
      selectedOverride,
      failedRun: {
        runId: quotaTerminal.runId,
        stepId: quotaTerminal.runTiming?.stepId,
        attempt: quotaTerminal.runTiming?.attempt,
      },
      overrideRun: {
        runId: overrideReply?.runId,
        stepId: overrideReply?.runTiming?.stepId,
        attempt: overrideReply?.runTiming?.attempt,
      },
    },
  );

  const storedProfile = await desktop.page.evaluate(async ({ teamId, memberSlug }) =>
    await window.moebius?.readAgentTeamExecutionProfile({
      teamId,
      ownership: "user",
      memberSlug,
    }) ?? null, team);
  assertEvidence(
    "A8-override-does-not-mutate-team-profile",
    storedProfile?.effectiveProfile.cli === "kimi",
    storedProfile,
  );

  await sendMessage(desktop.page, "NORMAL_AFTER_OVERRIDE");
  await desktop.page.getByText("KIMI_NORMAL_AFTER_OVERRIDE").waitFor();
  const overrideInvocations = await waitFor(async () => {
    const entries = await readProviderInvocations();
    return entries.some((entry) => entry.provider === "kimi" && entry.marker === "NORMAL_AFTER_OVERRIDE")
      ? entries
      : null;
  });
  const originalKimi = overrideInvocations.find((entry) =>
    entry.provider === "kimi" && entry.marker === "QUOTA_CONFIRMED");
  const resumedKimi = overrideInvocations.find((entry) =>
    entry.provider === "kimi" && entry.marker === "NORMAL_AFTER_OVERRIDE");
  assertEvidence(
    "A8-next-run-returns-to-original-kimi-session",
    overrideInvocations.some((entry) =>
      entry.provider === "codex" && entry.marker === "QUOTA_CONFIRMED" && entry.mode === "full")
      && resumedKimi?.mode === "resume"
      && resumedKimi.externalSessionId === originalKimi?.externalSessionId,
    overrideInvocations,
  );

  const idle = await createSession(desktop.apiBase, team.teamId, "Kimi 伪活动空转");
  await openSession(desktop.page, idle);
  const idleStartedAt = Date.now();
  await sendMessage(desktop.page, "PSEUDO_IDLE");
  const idleTerminal = await waitForAnyTerminal(desktop.apiBase, idle.sessionId);
  const idleElapsedMs = Date.now() - idleStartedAt;
  await desktop.page.getByRole("button", { name: "换执行配置重跑" }).waitFor();
  assertEvidence(
    "A3-pseudo-activity-does-not-refresh-idle",
    idleTerminal.terminal?.kind === "timeout"
      && idleTerminal.terminal.subkind === "idle"
      && idleElapsedMs < 15_000
      && await desktop.page.getByRole("button", { name: "换执行配置重跑" }).isVisible(),
    {
      elapsedMs: idleElapsedMs,
      terminal: terminalEvidence(idleTerminal),
      overrideActionVisible: true,
    },
  );

  const codexTeam = await createCodexTeam(desktop.page);
  const longTool = await createSession(desktop.apiBase, codexTeam.teamId, "Codex 长工具不中断");
  await openSession(desktop.page, longTool);
  const longToolStartedAt = Date.now();
  await sendMessage(desktop.page, "LONG_TOOL");
  const longToolActive = await waitForState(desktop.apiBase, longTool.sessionId, (state) =>
    state.activeRuns.find((run) => run.activity?.object === "acceptance-long-tool") ?? null);
  await desktop.page.getByText("acceptance-long-tool").waitFor();
  await desktop.page.getByText("LONG_TOOL_SUCCESS").waitFor({ timeout: 20_000 });
  const longToolElapsedMs = Date.now() - longToolStartedAt;
  const longToolState = await getState(desktop.apiBase, longTool.sessionId);
  assertEvidence(
    "A5-tool-in-flight-suspends-idle",
    longToolElapsedMs > 8_000
      && longToolState.messages.some((message) =>
        message.speaker === "agent" && message.body === "LONG_TOOL_SUCCESS")
      && !longToolState.messages.some((message) =>
        message.runId === longToolActive.runId && message.terminal?.kind === "timeout"),
    {
      configuredIdleMs: 8_000,
      elapsedMs: longToolElapsedMs,
      runId: longToolActive.runId,
      activity: longToolActive.activity,
    },
  );

  const overlongTool = await createSession(desktop.apiBase, codexTeam.teamId, "Codex 超大输出后完成");
  await openSession(desktop.page, overlongTool);
  await sendMessage(desktop.page, "OVERSIZED_TOOL_OUTPUT");
  const overlongToolActive = await waitForState(desktop.apiBase, overlongTool.sessionId, (state) =>
    state.activeRuns.find((run) => run.activity?.object === "acceptance-overlong-tool") ?? null);
  await desktop.page.getByText("acceptance-overlong-tool", { exact: true }).waitFor();
  assertEvidence(
    "A13-overlong-tool-start-is-visible",
    await desktop.page.getByTestId("active-run-block").count() === 1
      && await desktop.page.getByText("acceptance-overlong-tool", { exact: true }).isVisible(),
    { runId: overlongToolActive.runId, activity: overlongToolActive.activity },
  );
  await desktop.page.getByText("OVERSIZED_TOOL_SUCCESS", { exact: true }).waitFor({ timeout: 20_000 });
  const overlongToolCompleted = await waitForState(
    desktop.apiBase,
    overlongTool.sessionId,
    (state) => {
      const message = state.messages.find((candidate) =>
        candidate.speaker === "agent" && candidate.body === "OVERSIZED_TOOL_SUCCESS");
      return message !== undefined && !state.activeRuns.some((run) => run.runId === overlongToolActive.runId)
        ? { state, message }
        : null;
    },
  );
  await waitFor(async () =>
    await desktop!.page.getByTestId("active-run-block").count() === 0 ? true : null);
  const overlongMainText = await desktop.page.getByTestId("operator-main").innerText();
  assertEvidence(
    "A13-overlong-tool-settles-main-timeline",
    overlongToolCompleted.message.runTiming?.status === "completed"
      && !overlongToolCompleted.state.activeRuns.some((run) => run.runId === overlongToolActive.runId)
      && !overlongMainText.includes("正在运行命令"),
    {
      runId: overlongToolActive.runId,
      message: terminalEvidence(overlongToolCompleted.message),
      activeRunIds: overlongToolCompleted.state.activeRuns.map((run) => run.runId),
      activeBlockCount: await desktop.page.getByTestId("active-run-block").count(),
    },
  );

  await desktop.page.getByText("OVERSIZED_TOOL_SUCCESS", { exact: true }).hover();
  const overlongOutputButton = desktop.page.getByRole("button", { name: "完整输出" }).last();
  await overlongOutputButton.waitFor();
  await overlongOutputButton.click();
  const overlongProcessTab = desktop.page.getByTestId("process-tab");
  await overlongProcessTab.waitFor();
  await overlongProcessTab.getByText("acceptance-overlong-tool", { exact: true }).waitFor();
  const overlongProcessText = await waitFor(async () => {
    const text = await overlongProcessTab.innerText();
    return text.includes("acceptance-overlong-tool") && text.includes("completed") ? text : null;
  });
  assertEvidence(
    "A13-overlong-tool-settles-full-output",
    overlongProcessText.includes("acceptance-overlong-tool")
      && overlongProcessText.includes("completed")
      && !overlongProcessText.includes("running")
      && overlongToolCompleted.message.runTiming?.status === "completed"
      && !overlongToolCompleted.state.activeRuns.some((run) => run.runId === overlongToolActive.runId)
      && await desktop.page.getByTestId("active-run-block").count() === 0,
    {
      runId: overlongToolActive.runId,
      processText: overlongProcessText,
      processTabVisible: await overlongProcessTab.isVisible(),
      activeRunIds: overlongToolCompleted.state.activeRuns.map((run) => run.runId),
      activeBlockCount: await desktop.page.getByTestId("active-run-block").count(),
    },
  );

  // The process tab intentionally keeps the right sidebar open across session switches.
  // Close it through the real overlay control before returning to the main composer.
  await desktop.page.getByTestId("right-sidebar-overlay-close").click();
  await desktop.page.getByTestId("right-sidebar").waitFor({ state: "detached" });

  const hungTool = await createSession(desktop.apiBase, codexTeam.teamId, "Codex 挂死工具被监督");
  await openSession(desktop.page, hungTool);
  const hungToolStartedAt = Date.now();
  await sendMessage(desktop.page, "HUNG_TOOL");
  const hungToolActive = await waitForState(desktop.apiBase, hungTool.sessionId, (state) =>
    state.activeRuns.find((run) => run.activity?.object === "git push") ?? null);
  await desktop.page.getByText("git push").waitFor();
  const hungToolTerminal = await waitForTerminal(
    desktop.apiBase,
    hungTool.sessionId,
    hungToolActive.runId,
    "timeout",
    25_000,
  );
  await desktop.page.getByText("这一步的工具调用运行过久，已经停下。").waitFor();
  const hungToolElapsedMs = Date.now() - hungToolStartedAt;
  const hungToolState = await getState(desktop.apiBase, hungTool.sessionId);
  assertEvidence(
    "A5-hung-tool-is-bounded",
    hungToolTerminal.terminal?.subkind === "tool"
      && hungToolElapsedMs >= 15_000
      && hungToolElapsedMs < 25_000
      && !hungToolState.activeRuns.some((run) => run.runId === hungToolActive.runId),
    {
      configuredToolTimeoutMs: 15_000,
      elapsedMs: hungToolElapsedMs,
      activity: hungToolActive.activity,
      terminal: terminalEvidence(hungToolTerminal),
    },
  );

  const busy = await createSession(desktop.apiBase, team.teamId, "Kimi 服务繁忙");
  await openSession(desktop.page, busy);
  await sendMessage(desktop.page, "PROVIDER_BUSY");
  const busyActive = await waitForState(desktop.apiBase, busy.sessionId, (state) =>
    state.activeRuns.find((run) => run.activity?.action === "对方服务繁忙，正在第 3 次重试") ?? null);
  await desktop.page.getByText("对方服务繁忙，正在第 3 次重试").waitFor();
  const busyTerminal = await waitForTerminal(
    desktop.apiBase,
    busy.sessionId,
    busyActive.runId,
    "rate-limited",
  );
  await desktop.page.getByText("对方服务持续繁忙").waitFor();
  assertEvidence(
    "A4-busy-visible-and-bounded",
    busyTerminal.body.includes("服务持续繁忙")
      && await desktop.page.getByText("对方服务持续繁忙").isVisible(),
    {
      activity: busyActive.activity,
      terminal: terminalEvidence(busyTerminal),
      configuredGateMs: 1_500,
    },
  );

  const longRun = await createSession(desktop.apiBase, team.teamId, "Kimi 长运行只报告");
  await openSession(desktop.page, longRun);
  await sendMessage(desktop.page, "LONG_PROGRESS");
  const longActive = await waitForState(desktop.apiBase, longRun.sessionId, (state) =>
    state.activeRuns.find((run) =>
      run.activity?.action.startsWith("已经运行 1 分钟，") === true) ?? null);
  await desktop.page.getByText(/^已经运行 1 分钟，/u).waitFor();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const longStillRunning = await getState(desktop.apiBase, longRun.sessionId);
  assertEvidence(
    "A5-long-run-report-does-not-stop-progressing-run",
    longStillRunning.activeRuns.some((run) => run.runId === longActive.runId)
      && !longStillRunning.messages.some((message) => message.runId === longActive.runId && message.terminal),
    { activity: longActive.activity, activeRunIds: longStillRunning.activeRuns.map((run) => run.runId) },
  );
  await desktop.page.getByRole("button", { name: "停下主理人" }).click();
  await waitForTerminal(desktop.apiBase, longRun.sessionId, longActive.runId, "interrupted");

  scenarios.interruption = {
    sessionId: interrupted.sessionId,
    runId: interruptedActive.runId,
    terminal: terminalEvidence(interruptedTerminal),
  };
  scenarios.quotaAndOverride = {
    sessionId: quota.sessionId,
    terminal: terminalEvidence(quotaTerminal),
    providerInvocations: overrideInvocations,
    storedProfile,
  };
  scenarios.watchdogs = {
    idle: terminalEvidence(idleTerminal),
    busy: terminalEvidence(busyTerminal),
    longTool: {
      sessionId: longTool.sessionId,
      runId: longToolActive.runId,
      elapsedMs: longToolElapsedMs,
    },
    overlongTool: {
      sessionId: overlongTool.sessionId,
      runId: overlongToolActive.runId,
      mainTimeline: terminalEvidence(overlongToolCompleted.message),
      fullOutput: overlongProcessText,
    },
    hungTool: terminalEvidence(hungToolTerminal),
    longRunId: longActive.runId,
  };
  completed = true;
} finally {
  await desktop?.application.close().catch(() => undefined);
  const evidence: Evidence = {
    generatedAt: new Date().toISOString(),
    entry: "production Electron main conversation with real local runtime adapters",
    runtimeRoot,
    assertions,
    scenarios,
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    evidencePath,
    runtimeRoot,
    passed: completed && assertions.length > 0 && assertions.every((entry) => entry.passed),
    assertionCount: assertions.length,
  }));
}

function assertEvidence(id: string, passed: boolean, observed: unknown): void {
  assertions.push({ id, passed, observed });
  if (!passed) {
    throw new Error(`Acceptance assertion failed: ${id}: ${JSON.stringify(observed)}`);
  }
}

async function launchDesktop(): Promise<{
  application: ElectronApplication;
  page: Page;
  apiBase: string;
}> {
  const application = await electron.launch({
    args: [desktopRoot],
    cwd: desktopRoot,
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      CODEX_HOME: codexHome,
      MOEBIUS_DATA_ROOT: runtimeRoot,
      MOEBIUS_DISABLE_UPDATE_CHECK: "1",
      MOEBIUS_LOCAL_RUN_IDLE_TIMEOUT_MS: "8000",
      MOEBIUS_LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS: "15000",
      MOEBIUS_LOCAL_PROVIDER_BUSY_TIMEOUT_MS: "1500",
      MOEBIUS_LOCAL_LONG_RUN_REPORT_MS: "500",
    },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByLabel("消息内容").waitFor();
  const apiBase = await waitFor(async () =>
    await page.evaluate(async () => await window.moebius?.getLocalConsoleUrl?.() ?? null));
  return { application, page, apiBase };
}

async function createKimiTeam(page: Page): Promise<{ teamId: string; memberSlug: string }> {
  return await page.evaluate(async () => {
    if (window.moebius === undefined) throw new Error("desktop preload is unavailable");
    const team = await window.moebius.createAgentTeam({
      name: "Kimi runtime acceptance",
      description: "Runtime supervision acceptance fixture",
    });
    const added = await window.moebius.addAgentTeamMember({
      teamId: team.id,
      ownership: "user",
    });
    await window.moebius.saveAgentTeamExecutionProfile({
      teamId: team.id,
      ownership: "user",
      memberSlug: added.member.slug,
      profile: {
        cli: "kimi",
        model: "kimi-code/kimi-for-coding",
        effort: "on",
      },
    });
    return { teamId: team.id, memberSlug: added.member.slug };
  });
}

async function createCodexTeam(page: Page): Promise<{ teamId: string; memberSlug: string }> {
  return await page.evaluate(async () => {
    if (window.moebius === undefined) throw new Error("desktop preload is unavailable");
    const team = await window.moebius.createAgentTeam({
      name: "Codex runtime acceptance",
      description: "Long tool supervision acceptance fixture",
    });
    const added = await window.moebius.addAgentTeamMember({
      teamId: team.id,
      ownership: "user",
    });
    await window.moebius.saveAgentTeamExecutionProfile({
      teamId: team.id,
      ownership: "user",
      memberSlug: added.member.slug,
      profile: {
        cli: "codex",
        model: "gpt-5.6-sol",
        effort: "high",
      },
    });
    return { teamId: team.id, memberSlug: added.member.slug };
  });
}

async function createSession(apiBase: string, teamId: string, title: string): Promise<SessionSummary> {
  const response = await fetch(new URL("/api/local-console/sessions", apiBase), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title,
      agentTeamOwnership: "user",
      agentTeamId: teamId,
    }),
  });
  const payload = await response.json() as { session?: SessionSummary; error?: string };
  if (!response.ok || payload.session === undefined) {
    throw new Error(`create session failed: ${String(response.status)} ${JSON.stringify(payload)}`);
  }
  return payload.session;
}

async function openSession(page: Page, session: SessionSummary): Promise<void> {
  const row = page.locator(`[data-session-id="${session.sessionId}"]`).first();
  await row.waitFor();
  await row.click();
  await page.getByTestId("conversation-title-header").getByText(session.title, { exact: true }).waitFor();
}

async function sendMessage(page: Page, body: string): Promise<void> {
  const composer = page.getByLabel("消息内容");
  await composer.fill(body);
  await page.getByRole("button", { name: "发送消息" }).click();
}

async function getState(apiBase: string, sessionId: string): Promise<LocalConsoleStateSnapshot> {
  const url = new URL("/api/local-console/state", apiBase);
  url.searchParams.set("sessionId", sessionId);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`state failed: ${String(response.status)} ${await response.text()}`);
  }
  return await response.json() as LocalConsoleStateSnapshot;
}

async function waitForState<T>(
  apiBase: string,
  sessionId: string,
  project: (state: LocalConsoleStateSnapshot) => T | null,
  timeoutMs = 15_000,
): Promise<T> {
  let latest: LocalConsoleStateSnapshot | null = null;
  try {
    return await waitFor(async () => {
      latest = await getState(apiBase, sessionId);
      return project(latest);
    }, timeoutMs);
  } catch (error) {
    throw new Error(`${String(error)}; latest=${JSON.stringify(latest)}`);
  }
}

async function waitForTerminal(
  apiBase: string,
  sessionId: string,
  runId: string,
  kind: NonNullable<LocalConsoleMessage["terminal"]>["kind"],
  timeoutMs = 15_000,
): Promise<LocalConsoleMessage> {
  return await waitForState(apiBase, sessionId, (state) =>
    state.messages.find((message) =>
      message.runId === runId && message.terminal?.kind === kind) ?? null, timeoutMs);
}

async function waitForAnyTerminal(apiBase: string, sessionId: string): Promise<LocalConsoleMessage> {
  return await waitForState(apiBase, sessionId, (state) =>
    state.messages.find((message) => message.terminal !== null && message.terminal !== undefined) ?? null);
}

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== null) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out after ${String(timeoutMs)}ms${lastError === null ? "" : `: ${String(lastError)}`}`);
}

function terminalEvidence(message: LocalConsoleMessage): unknown {
  return {
    runId: message.runId,
    body: message.body,
    status: message.status,
    systemEventKind: message.systemEventKind,
    terminal: message.terminal,
  };
}

async function readProviderInvocations(): Promise<ProviderInvocation[]> {
  const content = await fs.readFile(providerLog, "utf8");
  return content
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as ProviderInvocation);
}

function kimiShimSource(): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
const logPath = ${JSON.stringify(providerLog)};
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("kimi 1.0.0\\n");
  process.exit(0);
}
const configOptions = [
  { id: "model", currentValue: "kimi-code/kimi-for-coding", options: [{ value: "kimi-code/kimi-for-coding" }] },
  { id: "thinking", currentValue: "on", options: [{ value: "on" }] },
  { id: "mode", currentValue: "auto", options: [{ value: "auto" }] },
];
let sessionId = null;
let timers = [];
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
const fail = (id, error) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error }) + "\\n");
const update = (value) => process.stdout.write(JSON.stringify({
  jsonrpc: "2.0",
  method: "session/update",
  params: { sessionId, update: value },
}) + "\\n");
const promptText = (params) => Array.isArray(params?.prompt)
  ? params.prompt.map((part) => typeof part?.text === "string" ? part.text : "").join("\\n")
  : "";
const markerFor = (prompt) => [
  "NORMAL_AFTER_OVERRIDE",
  "PARTIAL_STOP",
  "EMPTY_RESULT",
  "QUOTA_CONFIRMED",
  "PSEUDO_IDLE",
  "PROVIDER_BUSY",
  "LONG_PROGRESS",
].find((marker) => prompt.includes(marker)) || "UNKNOWN";
const record = (mode, marker, externalSessionId) => fs.appendFileSync(logPath, JSON.stringify({
  provider: "kimi",
  mode,
  marker,
  externalSessionId,
  recordedAt: new Date().toISOString(),
}) + "\\n");
const interval = (callback, delay) => {
  const timer = setInterval(callback, delay);
  timers.push(timer);
};
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    reply(request.id, { protocolVersion: 1 });
    return;
  }
  if (request.method === "session/new") {
    sessionId = "kimi-session-" + String(process.pid);
    reply(request.id, { sessionId, configOptions });
    return;
  }
  if (request.method === "session/resume") {
    sessionId = request.params.sessionId;
    reply(request.id, { sessionId, configOptions });
    return;
  }
  if (request.method === "session/set_config_option") {
    reply(request.id, { configOptions });
    return;
  }
  if (request.method !== "session/prompt") return;
  const prompt = promptText(request.params);
  const marker = markerFor(prompt);
  const mode = prompt.includes("NORMAL_AFTER_OVERRIDE") ? "resume" : request.params.sessionId === sessionId ? "full" : "resume";
  record(mode, marker, sessionId);
  if (marker === "NORMAL_AFTER_OVERRIDE") {
    reply(request.id, { stopReason: "end_turn", finalText: "KIMI_NORMAL_AFTER_OVERRIDE" });
    return;
  }
  if (marker === "PARTIAL_STOP") {
    update({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "中断前已经产出的正文" },
    });
    return;
  }
  if (marker === "EMPTY_RESULT") {
    reply(request.id, { stopReason: "end_turn" });
    return;
  }
  if (marker === "QUOTA_CONFIRMED") {
    fail(request.id, {
      code: 403,
      message: "billing cycle usage limit reached",
      data: { retryable: false },
    });
    return;
  }
  if (marker === "PSEUDO_IDLE") {
    interval(() => update({ sessionUpdate: "status", message: "still waiting" }), 40);
    return;
  }
  if (marker === "PROVIDER_BUSY") {
    update({ sessionUpdate: "status", message: "engine overloaded, retry attempt 3" });
    interval(() => update({ sessionUpdate: "status", message: "engine overloaded, retry attempt 3" }), 40);
    return;
  }
  if (marker === "LONG_PROGRESS") {
    let index = 0;
    interval(() => update({
      sessionUpdate: "agent_thought_chunk",
      content: { text: "继续分析 " + String(++index) },
    }), 40);
    return;
  }
  reply(request.id, { stopReason: "end_turn", finalText: "KIMI_FIXTURE_COMPLETE" });
});
const stop = (signal) => {
  fs.appendFileSync(logPath, JSON.stringify({
    provider: "kimi",
    mode: "full",
    marker: signal,
    externalSessionId: sessionId,
    recordedAt: new Date().toISOString(),
  }) + "\\n");
  if (signal === "SIGTERM") process.exit(143);
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
`;
}

function codexShimSource(): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const logPath = ${JSON.stringify(providerLog)};
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("codex-cli 0.145.0\\n");
  process.exit(0);
}
const resumeIndex = args.indexOf("resume");
const mode = resumeIndex >= 0 ? "resume" : "full";
const prompt = args.at(-1) || "";
const marker = prompt.includes("QUOTA_CONFIRMED")
  ? "QUOTA_CONFIRMED"
  : prompt.includes("OVERSIZED_TOOL_OUTPUT")
    ? "OVERSIZED_TOOL_OUTPUT"
  : prompt.includes("LONG_TOOL")
    ? "LONG_TOOL"
    : prompt.includes("HUNG_TOOL")
      ? "HUNG_TOOL"
    : "UNKNOWN";
fs.appendFileSync(logPath, JSON.stringify({
  provider: "codex",
  mode,
  marker,
  externalSessionId: null,
  recordedAt: new Date().toISOString(),
}) + "\\n");
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
const threadId = "codex-override-" + String(process.pid);
emit({ type: "thread.started", thread_id: threadId });
if (marker === "OVERSIZED_TOOL_OUTPUT") {
  const rolloutPath = path.join(
    ${JSON.stringify(codexHome)},
    "sessions",
    "2026",
    "08",
    "05",
    "rollout-acceptance-" + threadId + ".jsonl",
  );
  fs.mkdirSync(path.dirname(rolloutPath), { recursive: true });
  const rolloutRecords = [
    {
      type: "session_meta",
      payload: {
        base_instructions: { text: "Codex runtime acceptance fixture" },
        model_provider: "fixture",
        cli_version: "0.145.0",
        cwd: process.cwd(),
      },
    },
    {
      type: "turn_context",
      payload: { model: "gpt-5.6-sol", effort: "high", cwd: process.cwd() },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "OVERSIZED_TOOL_OUTPUT" }],
      },
    },
    {
      type: "response_item",
      payload: {
        type: "command_execution",
        command: "acceptance-overlong-tool",
        status: "completed",
        output: "completed output",
        exit_code: 0,
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "OVERSIZED_TOOL_SUCCESS" }],
      },
    },
  ];
  fs.writeFileSync(
    rolloutPath,
    rolloutRecords.map((record) => JSON.stringify({ timestamp: new Date().toISOString(), ...record })).join("\\n") + "\\n",
  );
  emit({
    type: "item.started",
    item: {
      id: "acceptance-overlong-tool",
      type: "command_execution",
      command: "acceptance-overlong-tool",
    },
  });
  setTimeout(() => {
    process.stdout.write(JSON.stringify({
      type: "item.completed",
      item: {
        id: "acceptance-overlong-tool",
        type: "command_execution",
        command: "acceptance-overlong-tool",
        output: "x".repeat(1024 * 1024),
      },
    }) + "\\n");
    emit({ type: "item.completed", item: { type: "agent_message", text: "OVERSIZED_TOOL_SUCCESS" } });
    emit({ type: "turn.completed" });
    setTimeout(() => {}, 1_000);
  }, 2_000);
  return;
}
if (marker === "LONG_TOOL") {
  emit({
    type: "item.started",
    item: {
      id: "acceptance-long-tool",
      type: "command_execution",
      command: "acceptance-long-tool",
    },
  });
  setTimeout(() => {
    emit({
      type: "item.completed",
      item: {
        id: "acceptance-long-tool",
        type: "command_execution",
        command: "acceptance-long-tool",
      },
    });
    emit({ type: "item.completed", item: { type: "agent_message", text: "LONG_TOOL_SUCCESS" } });
    emit({ type: "turn.completed", usage: { cached_input_tokens: 0 } });
  }, 12000);
  return;
}
if (marker === "HUNG_TOOL") {
  emit({
    type: "item.started",
    item: {
      type: "command_execution",
      command: "git push",
    },
  });
  setInterval(() => {}, 1000);
  return;
}
emit({ type: "item.completed", item: { type: "agent_message", text: "CODEX_OVERRIDE_SUCCESS" } });
emit({ type: "turn.completed", usage: { cached_input_tokens: 0 } });
`;
}
