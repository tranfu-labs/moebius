import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { createSqliteLocalConsoleStore } from "../../src/local-console/store.js";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

interface Invocation {
  invocationId: string;
  mode: "full" | "resume";
  pid: number;
  role: string;
  threadId: string;
  markers: string[];
  startedAt: string;
}

interface SignalEntry {
  invocationId: string;
  pid: number;
  signal: string;
  recordedAt: string;
}

interface PendingDispatch {
  message: { id: number; body: string; status: string };
  targetLane: "primary" | "worker" | "awaiting-team";
  targetRole: string | null;
  waitingForTeam: boolean;
}

interface RunSnapshot {
  runId: string;
  role: string | null;
  lane: "primary" | "worker";
}

interface StateSnapshot {
  messages: Array<{
    id: number;
    speaker: "user" | "agent" | "system";
    role: string | null;
    body: string;
    status: string;
  }>;
  pendingDispatchMessages: PendingDispatch[];
  activeRuns: RunSnapshot[];
  hasPendingControlWork?: boolean;
}

interface SessionSummary {
  sessionId: string;
  title: string;
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
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-direct-mention-runtime-"));
const codexHome = path.join(runtimeRoot, "codex-home");
const controlRoot = path.join(runtimeRoot, "shim-control");
const shimBin = path.join(runtimeRoot, "bin");
const invocationLog = path.join(controlRoot, "invocations.jsonl");
const signalLog = path.join(controlRoot, "signals.jsonl");
const evidenceRoot = await createAcceptanceOutputDirectory("local-console-direct-member-mention");
const evidencePath = path.join(evidenceRoot, "evidence.json");
const assertions: Evidence["assertions"] = [];
const scenarios: Record<string, unknown> = {};
let acceptanceCompleted = false;

await fs.mkdir(path.join(runtimeRoot, ".state"), { recursive: true });
await fs.mkdir(codexHome, { recursive: true });
await fs.mkdir(controlRoot, { recursive: true });
await fs.mkdir(shimBin, { recursive: true });
await fs.writeFile(path.join(runtimeRoot, ".onboarding-completed"), `${new Date().toISOString()}\n`, "utf8");
await fs.writeFile(invocationLog, "", "utf8");
await fs.writeFile(signalLog, "", "utf8");
await writeCodexShim();
const legacy = await prepareLegacyPendingSession();

function assertEvidence(id: string, condition: boolean, observed: unknown): void {
  assertions.push({ id, passed: condition, observed });
  if (!condition) {
    throw new Error(`Acceptance assertion failed: ${id}: ${JSON.stringify(observed)}`);
  }
}

function markerPath(kind: "hold" | "release", marker: string): string {
  return path.join(controlRoot, `${kind}-${marker}`);
}

async function hold(marker: string): Promise<void> {
  await fs.writeFile(markerPath("hold", marker), `${new Date().toISOString()}\n`, "utf8");
}

async function release(marker: string): Promise<string> {
  await fs.rm(markerPath("hold", marker), { force: true });
  const releasedAt = new Date().toISOString();
  await fs.writeFile(markerPath("release", marker), `${releasedAt}\n`, "utf8");
  return releasedAt;
}

async function launchDesktop(): Promise<{ application: ElectronApplication; page: Page; apiBase: string }> {
  const application = await electron.launch({
    args: [desktopRoot],
    cwd: desktopRoot,
    env: {
      ...process.env,
      PATH: `${shimBin}${path.delimiter}${process.env.PATH ?? ""}`,
      CODEX_HOME: codexHome,
      MOEBIUS_DATA_ROOT: runtimeRoot,
      MOEBIUS_DISABLE_UPDATE_CHECK: "1",
    },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  const apiBase = await waitFor(async () =>
    page.evaluate(async () => await window.moebius?.getLocalConsoleUrl?.() ?? null),
  );
  await page.getByLabel("消息内容").waitFor();
  return { application, page, apiBase };
}

async function createSession(apiBase: string, title: string): Promise<SessionSummary> {
  const response = await fetch(new URL("/api/local-console/sessions", apiBase), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title,
      agentTeamOwnership: "system",
      agentTeamId: "development",
    }),
  });
  const payload = await response.json() as { session?: SessionSummary; error?: string };
  if (!response.ok || payload.session === undefined) {
    throw new Error(`create session failed: ${String(response.status)} ${JSON.stringify(payload)}`);
  }
  return payload.session;
}

async function sendFromMainConversation(
  page: Page,
  session: SessionSummary,
  body: string,
): Promise<void> {
  const sessionEntry = page.getByText(session.title, { exact: true }).first();
  await sessionEntry.waitFor();
  await sessionEntry.click();
  await page
    .getByTestId("conversation-title-header")
    .getByRole("heading", { name: session.title, exact: true })
    .waitFor();
  const composer = page.getByLabel("消息内容");
  await composer.fill(body);
  await page.getByRole("button", { name: "发送消息" }).click();
}

async function getState(apiBase: string, sessionId: string): Promise<StateSnapshot> {
  const url = new URL("/api/local-console/state", apiBase);
  url.searchParams.set("sessionId", sessionId);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`state failed: ${String(response.status)} ${await response.text()}`);
  }
  return await response.json() as StateSnapshot;
}

async function waitForState(
  apiBase: string,
  sessionId: string,
  predicate: (state: StateSnapshot) => boolean,
): Promise<StateSnapshot> {
  let latest: StateSnapshot | null = null;
  try {
    return await waitFor(async () => {
      latest = await getState(apiBase, sessionId);
      return predicate(latest) ? latest : null;
    }, 15_000);
  } catch (error) {
    throw new Error(`${String(error)}; sessionId=${sessionId}; latest=${JSON.stringify(latest)}`);
  }
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);
}

async function invocationsFor(marker: string): Promise<Invocation[]> {
  return (await readJsonLines<Invocation>(invocationLog))
    .filter((entry) => entry.markers.includes(marker));
}

async function waitForInvocation(marker: string, count = 1): Promise<Invocation[]> {
  return await waitFor(async () => {
    const matching = await invocationsFor(marker);
    return matching.length >= count ? matching : null;
  });
}

async function waitFor<T>(
  read: () => Promise<T | null>,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== null) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for acceptance state${lastError === null ? "" : `: ${String(lastError)}`}`);
}

let desktop = await launchDesktop();
try {
  const legacyInvocations = await waitForInvocation("LEGACY_PENDING");
  const legacyState = await waitForState(desktop.apiBase, legacy.sessionId, (state) =>
    state.activeRuns.some((run) => run.role === "dev-manager"),
  );
  assertEvidence("legacy-pending-primary", legacyInvocations[0]?.role === "dev-manager", legacyInvocations[0]);
  assertEvidence(
    "legacy-history-unchanged",
    legacyState.messages.some((message) => message.body === "@qa LEGACY_PENDING"),
    legacyState.messages,
  );
  await release("LEGACY_PENDING");
  await waitForState(desktop.apiBase, legacy.sessionId, (state) =>
    state.messages.some((message) => message.speaker === "agent" && message.role === "dev-manager"),
  );

  await hold("LEGACY_NEW");
  await sendFromMainConversation(desktop.page, legacy, "@qa LEGACY_NEW");
  const legacyNew = await waitForInvocation("LEGACY_NEW");
  assertEvidence("legacy-new-message-direct", legacyNew[0]?.role === "qa", legacyNew[0]);
  await release("LEGACY_NEW");

  const direct = await createSession(desktop.apiBase, "direct qa");
  await hold("ROUTE_QA");
  await sendFromMainConversation(desktop.page, direct, "@qa 只回复 ROUTE-QA ROUTE_QA");
  const directInvocations = await waitForInvocation("ROUTE_QA");
  const directRunning = await waitForState(desktop.apiBase, direct.sessionId, (state) =>
    state.activeRuns.some((run) => run.role === "qa"),
  );
  assertEvidence(
    "single-valid-direct-first-stage",
    directInvocations.length === 1
      && directInvocations[0]?.role === "qa"
      && !directRunning.activeRuns.some((run) => run.role === "dev-manager" || run.role === "dev"),
    { invocations: directInvocations, activeRuns: directRunning.activeRuns },
  );
  await release("ROUTE_QA");
  const directCompleted = await waitForState(desktop.apiBase, direct.sessionId, (state) =>
    state.messages.some((message) =>
      message.speaker === "agent" && message.role === "qa" && message.body.includes("ROUTE-QA")),
  );
  await desktop.page.getByText("ROUTE-QA", { exact: false }).first().waitFor();
  scenarios.direct = {
    entry: "生产桌面主对话",
    sessionId: direct.sessionId,
    sent: "@qa 只回复 ROUTE-QA ROUTE_QA",
    firstInvocation: directInvocations[0],
    firstAgent: directCompleted.messages.find((message) => message.speaker === "agent"),
    notStartedDuringFirstStage: ["dev-manager", "dev"],
  };

  for (const fallback of [
    { marker: "FALLBACK_NONE", body: "FALLBACK_NONE 没有点名" },
    { marker: "FALLBACK_INVALID", body: "@unknown FALLBACK_INVALID" },
    { marker: "FALLBACK_MULTI", body: "@qa @dev FALLBACK_MULTI" },
  ]) {
    const session = await createSession(desktop.apiBase, fallback.marker);
    await hold(fallback.marker);
    await sendFromMainConversation(desktop.page, session, fallback.body);
    const invocations = await waitForInvocation(fallback.marker);
    const running = await waitForState(desktop.apiBase, session.sessionId, (state) =>
      state.activeRuns.some((run) => run.role === "dev-manager"),
    );
    assertEvidence(
      `fallback-${fallback.marker}`,
      invocations.length === 1
        && invocations[0]?.role === "dev-manager"
        && !running.activeRuns.some((run) => run.role === "qa" || run.role === "dev"),
      { sessionId: session.sessionId, invocations, activeRuns: running.activeRuns },
    );
    await release(fallback.marker);
    await waitForState(desktop.apiBase, session.sessionId, (state) =>
      state.messages.some((message) => message.speaker === "agent" && message.role === "dev-manager"),
    );
    scenarios[fallback.marker] = {
      sessionId: session.sessionId,
      sent: fallback.body,
      firstInvocation: invocations[0],
      notStarted: ["qa", "dev"],
    };
  }

  const primaryThenQa = await createSession(desktop.apiBase, "primary then qa parallel");
  await hold("PRIMARY_PARALLEL");
  await hold("QA_PARALLEL");
  await sendFromMainConversation(desktop.page, primaryThenQa, "PRIMARY_PARALLEL 主理人先运行");
  const primaryParallelInvocation = (await waitForInvocation("PRIMARY_PARALLEL"))[0]!;
  const primaryParallelState = await waitForState(desktop.apiBase, primaryThenQa.sessionId, (state) =>
    state.activeRuns.some((run) => run.role === "dev-manager"),
  );
  const primaryParallelRun = primaryParallelState.activeRuns.find((run) => run.role === "dev-manager")!;
  const parallelSignalBaseline = (await readJsonLines<SignalEntry>(signalLog)).length;
  await sendFromMainConversation(desktop.page, primaryThenQa, "@qa QA_PARALLEL");
  const qaParallelInvocation = (await waitForInvocation("QA_PARALLEL"))[0]!;
  const primaryAndQaRunning = await waitForState(desktop.apiBase, primaryThenQa.sessionId, (state) =>
    state.activeRuns.some((run) => run.role === "dev-manager")
      && state.activeRuns.some((run) => run.role === "qa"),
  );
  const visibleActiveRuns = await waitFor(async () => {
    const texts = await desktop.page.getByTestId("active-run-block").allTextContents();
    return texts.some((text) => text.includes("开发经理"))
      && texts.some((text) => text.includes("软件测试"))
      ? texts
      : null;
  }, 15_000);
  const parallelSignals = await readJsonLines<SignalEntry>(signalLog);
  assertEvidence(
    "primary-running-direct-qa-starts-in-parallel",
    primaryParallelInvocation.role === "dev-manager"
      && qaParallelInvocation.role === "qa"
      && primaryAndQaRunning.activeRuns.find((run) => run.role === "dev-manager")?.runId === primaryParallelRun.runId
      && primaryAndQaRunning.activeRuns.filter((run) => run.role === "qa").length === 1
      && !primaryAndQaRunning.pendingDispatchMessages.some((item) => item.message.body.includes("QA_PARALLEL"))
      && parallelSignals.length === parallelSignalBaseline
      && visibleActiveRuns.some((text) => text.includes("开发经理"))
      && visibleActiveRuns.some((text) => text.includes("软件测试")),
    {
      entry: "生产桌面主对话",
      sent: ["PRIMARY_PARALLEL 主理人先运行", "@qa QA_PARALLEL"],
      invocations: [primaryParallelInvocation, qaParallelInvocation],
      activeRuns: primaryAndQaRunning.activeRuns,
      pending: primaryAndQaRunning.pendingDispatchMessages,
      visibleActiveRuns,
      signals: parallelSignals.slice(parallelSignalBaseline),
    },
  );
  scenarios.primaryThenQa = {
    entry: "生产桌面主对话",
    sessionId: primaryThenQa.sessionId,
    sent: ["PRIMARY_PARALLEL 主理人先运行", "@qa QA_PARALLEL"],
    primaryRunId: primaryParallelRun.runId,
    primaryPid: primaryParallelInvocation.pid,
    qaRunId: primaryAndQaRunning.activeRuns.find((run) => run.role === "qa")?.runId,
    qaPid: qaParallelInvocation.pid,
    activeRoles: primaryAndQaRunning.activeRuns.map((run) => run.role),
    visibleActiveRuns,
    signalsBeforeRelease: parallelSignals.slice(parallelSignalBaseline),
  };
  await release("QA_PARALLEL");
  await release("PRIMARY_PARALLEL");
  await waitForState(desktop.apiBase, primaryThenQa.sessionId, (state) =>
    state.activeRuns.length === 0,
  );

  const fifo = await createSession(desktop.apiBase, "qa busy fifo");
  await hold("FIFO_FIRST");
  await sendFromMainConversation(desktop.page, fifo, "@qa FIFO_FIRST");
  const firstFifoInvocation = (await waitForInvocation("FIFO_FIRST"))[0]!;
  const firstFifoState = await waitForState(desktop.apiBase, fifo.sessionId, (state) =>
    state.activeRuns.some((run) => run.role === "qa"),
  );
  const firstFifoRun = firstFifoState.activeRuns.find((run) => run.role === "qa")!;
  const signalBaseline = (await readJsonLines<SignalEntry>(signalLog)).length;
  await sendFromMainConversation(desktop.page, fifo, "@qa FIFO_SECOND");
  const queuedFifo = await waitForState(desktop.apiBase, fifo.sessionId, (state) =>
    state.pendingDispatchMessages.some((item) =>
      item.targetRole === "qa" && item.message.body.includes("FIFO_SECOND")),
  );
  const pendingText = await desktop.page.getByTestId("primary-pending-zone").textContent();
  const beforeReleaseSignals = await readJsonLines<SignalEntry>(signalLog);
  assertEvidence(
    "busy-qa-queues-without-abort",
    queuedFifo.activeRuns.filter((run) => run.role === "qa").length === 1
      && queuedFifo.activeRuns.find((run) => run.role === "qa")?.runId === firstFifoRun.runId
      && (await invocationsFor("FIFO_SECOND")).length === 0
      && beforeReleaseSignals.length === signalBaseline
      && pendingText?.includes("软件测试") === true
      && pendingText.includes("FIFO_SECOND"),
    {
      runId: firstFifoRun.runId,
      pid: firstFifoInvocation.pid,
      pending: queuedFifo.pendingDispatchMessages,
      visiblePendingText: pendingText,
      signals: beforeReleaseSignals.slice(signalBaseline),
    },
  );
  const fifoReleasedAt = await release("FIFO_FIRST");
  const secondFifoInvocation = (await waitForInvocation("FIFO_SECOND"))[0]!;
  assertEvidence(
    "busy-qa-fifo-drains-after-release",
    secondFifoInvocation.role === "qa" && secondFifoInvocation.startedAt >= fifoReleasedAt,
    { first: firstFifoInvocation, second: secondFifoInvocation, releasedAt: fifoReleasedAt },
  );
  scenarios.busyFifo = {
    sessionId: fifo.sessionId,
    firstRunId: firstFifoRun.runId,
    firstPid: firstFifoInvocation.pid,
    pendingTarget: "qa",
    signalsBeforeRelease: beforeReleaseSignals.slice(signalBaseline),
    releasedAt: fifoReleasedAt,
    secondInvocation: secondFifoInvocation,
  };

  const restart = await createSession(desktop.apiBase, "qa graceful restart");
  await hold("RESTART_FIRST");
  await sendFromMainConversation(desktop.page, restart, "@qa RESTART_FIRST");
  const restartFirstInvocation = (await waitForInvocation("RESTART_FIRST"))[0]!;
  const restartBefore = await waitForState(desktop.apiBase, restart.sessionId, (state) =>
    state.activeRuns.some((run) => run.role === "qa"),
  );
  const restartRun = restartBefore.activeRuns.find((run) => run.role === "qa")!;
  await sendFromMainConversation(desktop.page, restart, "@qa RESTART_SECOND");
  await waitForState(desktop.apiBase, restart.sessionId, (state) =>
    state.pendingDispatchMessages.some((item) =>
      item.targetRole === "qa" && item.message.body.includes("RESTART_SECOND")),
  );
  const restartSignalBaseline = (await readJsonLines<SignalEntry>(signalLog)).length;
  assertEvidence("restart-no-signal-before-close", restartSignalBaseline === beforeReleaseSignals.length, {
    restartSignalBaseline,
    priorSignalCount: beforeReleaseSignals.length,
  });

  await desktop.application.close();
  const shutdownSignals = await waitFor(async () => {
    const entries = await readJsonLines<SignalEntry>(signalLog);
    return entries.length > restartSignalBaseline ? entries : null;
  });
  desktop = await launchDesktop();
  const resumed = await waitFor(async () => {
    const matching = await invocationsFor("RESTART_FIRST");
    return matching.length >= 2 ? matching : null;
  }, 15_000);
  const resumedState = await waitForState(desktop.apiBase, restart.sessionId, (state) =>
    state.activeRuns.some((run) => run.role === "qa")
      && state.pendingDispatchMessages.some((item) => item.message.body.includes("RESTART_SECOND")),
  );
  const resumedRun = resumedState.activeRuns.find((run) => run.role === "qa")!;
  assertEvidence(
    "graceful-restart-resumes-same-run-and-thread",
    resumed[1]?.mode === "resume"
      && resumed[1]?.threadId === restartFirstInvocation.threadId
      && resumedRun.runId === restartRun.runId
      && resumedState.pendingDispatchMessages.some((item) => item.targetRole === "qa"),
    {
      before: { run: restartRun, invocation: restartFirstInvocation },
      shutdownSignals: shutdownSignals.slice(restartSignalBaseline),
      after: { run: resumedRun, invocation: resumed[1], pending: resumedState.pendingDispatchMessages },
    },
  );
  const restartReleasedAt = await release("RESTART_FIRST");
  const restartSecond = (await waitForInvocation("RESTART_SECOND"))[0]!;
  assertEvidence(
    "restart-pending-drains-without-full-replacement",
    restartSecond.role === "qa"
      && restartSecond.mode === "resume"
      && restartSecond.threadId === restartFirstInvocation.threadId
      && restartSecond.startedAt >= restartReleasedAt
      && resumed.every((entry) => entry.threadId === restartFirstInvocation.threadId),
    { resumed, second: restartSecond, releasedAt: restartReleasedAt },
  );
  scenarios.restart = {
    sessionId: restart.sessionId,
    runIdBefore: restartRun.runId,
    runIdAfter: resumedRun.runId,
    providerIdBefore: restartFirstInvocation.threadId,
    providerIdAfter: resumed[1]?.threadId,
    shutdownSignals: shutdownSignals.slice(restartSignalBaseline),
    pendingTargetAfterRestart: "qa",
    releasedAt: restartReleasedAt,
    secondInvocation: restartSecond,
  };
  acceptanceCompleted = true;
} finally {
  await desktop.application.close().catch(() => undefined);
  const evidence: Evidence = {
    generatedAt: new Date().toISOString(),
    entry: "production Electron desktop main conversation",
    runtimeRoot,
    assertions,
    scenarios,
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    evidencePath,
    runtimeRoot,
    passed: acceptanceCompleted && assertions.length > 0 && assertions.every((entry) => entry.passed),
    assertionCount: assertions.length,
  }));
}

async function prepareLegacyPendingSession(): Promise<SessionSummary> {
  const sqlitePath = path.join(runtimeRoot, ".state", "local-console.sqlite");
  const store = await createSqliteLocalConsoleStore({
    sqlitePath,
    sessionLogRoot: path.join(runtimeRoot, "sessions"),
  });
  await store.init();
  const session: SessionSummary = {
    sessionId: `local:${randomUUID()}`,
    title: "legacy pending",
  };
  await store.createSession({
    ...session,
    agentTeamOwnership: "system",
    agentTeamId: "development",
    agentTeamSnapshot: {
      members: [
        { name: "dev-manager", agentMarkdown: "# 开发经理" },
        { name: "dev", agentMarkdown: "# 开发" },
        { name: "qa", agentMarkdown: "# 软件测试" },
      ],
    },
    now: "2026-07-29T00:00:00.000Z",
  });
  const pending = await store.appendUserMessage({
    sessionId: session.sessionId,
    body: "@qa LEGACY_PENDING",
    dispatch: { lane: "worker", role: "qa", reason: "single-valid-mention" },
    now: "2026-07-29T00:00:01.000Z",
  });
  const factLogPath = store.getSessionFactLogPath(session.sessionId);
  await store.close();
  const facts = (await fs.readFile(factLogPath, "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => {
      const fact = JSON.parse(line) as { messageUpserts?: Array<Record<string, unknown>> };
      for (const message of fact.messageUpserts ?? []) {
        delete message.dispatchLane;
        delete message.dispatchRole;
        delete message.dispatchReason;
      }
      return JSON.stringify(fact);
    })
    .join("\n");
  await fs.writeFile(factLogPath, `${facts}\n`, "utf8");
  const database = new DatabaseSync(sqlitePath);
  database.prepare(
    `UPDATE session_messages
     SET dispatch_lane = NULL, dispatch_role = NULL, dispatch_reason = NULL
     WHERE id = ?`,
  ).run(pending.id);
  database.close();
  await hold("LEGACY_PENDING");
  return session;
}

async function writeCodexShim(): Promise<void> {
  const shimPath = path.join(shimBin, "codex");
  const source = `#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const controlRoot = ${JSON.stringify(controlRoot)};
const codexHome = ${JSON.stringify(codexHome)};
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("codex-cli 0.145.0\\n");
  process.exit(0);
}
const resumeIndex = args.indexOf("resume");
const mode = resumeIndex >= 0 ? "resume" : "full";
const separator = args.indexOf("--");
const positional = separator >= 0 ? args.slice(separator + 1) : [];
const threadId = mode === "resume" ? positional[0] : crypto.randomUUID();
const prompt = mode === "resume" ? positional.slice(1).join(" ") : positional.join(" ");
let role = prompt.includes("# 软件测试") ? "qa"
  : prompt.includes("# 开发经理") ? "dev-manager"
  : prompt.includes("# 开发") ? "dev"
  : "unknown";
const threadRolePath = path.join(controlRoot, "thread-role-" + threadId);
if (mode === "resume" && fs.existsSync(threadRolePath)) {
  role = fs.readFileSync(threadRolePath, "utf8").trim();
} else if (mode === "full") {
  fs.writeFileSync(threadRolePath, role + "\\n");
}
const knownMarkers = [
  "LEGACY_PENDING", "LEGACY_NEW", "ROUTE_QA",
  "FALLBACK_NONE", "FALLBACK_INVALID", "FALLBACK_MULTI",
  "PRIMARY_PARALLEL", "QA_PARALLEL",
  "FIFO_FIRST", "FIFO_SECOND", "RESTART_FIRST", "RESTART_SECOND",
];
let markers = knownMarkers.filter((marker) => prompt.includes(marker));
const threadMarkersPath = path.join(controlRoot, "thread-markers-" + threadId);
if (mode === "resume" && markers.length === 0 && fs.existsSync(threadMarkersPath)) {
  markers = JSON.parse(fs.readFileSync(threadMarkersPath, "utf8"));
} else if (mode === "full" && markers.length > 0) {
  fs.writeFileSync(threadMarkersPath, JSON.stringify(markers));
}
const invocationId = crypto.randomUUID();
const invocation = {
  invocationId,
  mode,
  pid: process.pid,
  role,
  threadId,
  markers,
  startedAt: new Date().toISOString(),
};
fs.appendFileSync(path.join(controlRoot, "invocations.jsonl"), JSON.stringify(invocation) + "\\n");
const rolloutDir = path.join(codexHome, "sessions", "2026", "07", "29");
fs.mkdirSync(rolloutDir, { recursive: true });
const rolloutPath = path.join(rolloutDir, "rollout-shim-" + threadId + ".jsonl");
if (!fs.existsSync(rolloutPath)) {
  fs.writeFileSync(rolloutPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    type: "session_meta",
    payload: {
      cwd: process.cwd(),
      model_provider: "shim",
      cli_version: "0.145.0",
      base_instructions: { text: "acceptance shim" },
    },
  }) + "\\n");
}
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: threadId }) + "\\n");
const writeSignal = (signal) => {
  fs.appendFileSync(path.join(controlRoot, "signals.jsonl"), JSON.stringify({
    invocationId,
    pid: process.pid,
    signal,
    recordedAt: new Date().toISOString(),
  }) + "\\n");
  process.exit(signal === "SIGINT" ? 130 : 143);
};
process.on("SIGINT", () => writeSignal("SIGINT"));
process.on("SIGTERM", () => writeSignal("SIGTERM"));
const heldMarker = markers.find((marker) =>
  fs.existsSync(path.join(controlRoot, "hold-" + marker)));
const finish = () => {
  const text = prompt.includes("ROUTE-QA") ? "ROUTE-QA" : "SHIM-" + role + "-" + (markers[0] || "DONE");
  process.stdout.write(JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text },
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "turn.completed",
    usage: { cached_input_tokens: 0 },
  }) + "\\n");
};
if (heldMarker === undefined) {
  finish();
  process.exit(0);
}
const timer = setInterval(() => {
  if (fs.existsSync(path.join(controlRoot, "release-" + heldMarker))) {
    clearInterval(timer);
    finish();
    process.exit(0);
  }
}, 25);
`;
  await fs.writeFile(shimPath, source, { encoding: "utf8", mode: 0o755 });
}
