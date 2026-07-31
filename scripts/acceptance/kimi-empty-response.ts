import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import { createSqliteLocalConsoleStore } from "../../src/local-console/store.js";
import type {
  LocalConsoleAgentTeamSnapshot,
  LocalConsoleExecutionProfile,
} from "../../src/local-console/types.js";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

const SAFE_MESSAGE =
  "Kimi 没有返回可用回复。请在终端直接运行 kimi 查看详细错误，然后重试。";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(projectRoot, "desktop");
const evidenceDir = await createAcceptanceOutputDirectory("kimi-empty-response");
const evidencePath = path.join(evidenceDir, "evidence.json");
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-kimi-empty-"));
const workspace = path.join(runtimeRoot, "workspace");
const sqlitePath = path.join(runtimeRoot, ".state", "local-console.sqlite");
const sessionLogRoot = path.join(runtimeRoot, "sessions");
const marker = `KIMI_EMPTY_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const sessionId = `local:${randomUUID()}`;
const sessionTitle = `Kimi 空响应验收 ${marker.slice(-6)}`;
const kimiProfile = {
  cli: "kimi",
  model: "kimi-code/kimi-for-coding",
  effort: "on",
} satisfies LocalConsoleExecutionProfile;
const teamSnapshot = {
  members: [
    {
      name: "kimi-dev",
      agentMarkdown: [
        "---",
        "name: kimi-dev",
        "displayName: Kimi 验收",
        "---",
        "# Kimi 验收",
        "",
        "按用户要求执行；不要委派给其他成员。",
      ].join("\n"),
      executionProfile: kimiProfile,
    },
  ],
} satisfies LocalConsoleAgentTeamSnapshot;

await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(path.join(runtimeRoot, ".onboarding-completed"), `${new Date().toISOString()}\n`, "utf8");

const store = await createSqliteLocalConsoleStore({
  sqlitePath,
  sessionLogRoot,
  timeoutMs: 10_000,
});
await store.init();
const project = await store.createProject({
  folderPath: workspace,
  worktreeMode: false,
  now: new Date().toISOString(),
});
await store.createSession({
  sessionId,
  projectId: project.projectId,
  title: sessionTitle,
  agentTeamOwnership: "system",
  agentTeamId: "development",
  agentTeamSnapshot: teamSnapshot,
  now: new Date().toISOString(),
});
const factLogPath = store.getSessionFactLogPath(sessionId);
await store.close();

let desktop: Awaited<ReturnType<typeof launchDesktop>> | null = null;
let restartedDesktop: Awaited<ReturnType<typeof launchDesktop>> | null = null;
try {
  desktop = await launchDesktop();
  await selectSession(desktop.page);
  await sendFromMainConversation(
    desktop.page,
    `@kimi-dev ${marker}。请只回复一个简短确认。`,
  );
  const firstState = await waitForTerminalState(desktop.apiBase, 180_000);
  const firstFailures = emptyFailures(firstState);
  if (firstFailures.length !== 1) {
    await writePreconditionEvidence(firstState, "first Kimi turn did not produce kimi-empty-response");
    throw new Error(`Kimi empty-response precondition was not reproduced; evidence: ${evidencePath}`);
  }
  await assertFailurePage(desktop.page, 1);

  const firstFailure = firstFailures[0]!;
  const retry = desktop.page.getByRole("button", { name: "重试" });
  await retry.waitFor({ timeout: 20_000 });
  await retry.click();
  const secondState = await waitForState(
    desktop.apiBase,
    (state) => state.activeRuns.length === 0 && emptyFailures(state).length === 2,
    180_000,
  );
  await assertFailurePage(desktop.page, 2);
  const secondFailure = emptyFailures(secondState)
    .find((message) => message.runId !== firstFailure.runId);
  if (secondFailure === undefined) {
    throw new Error("Kimi retry did not produce an independent second failed attempt");
  }

  const facts = await readFacts(factLogPath);
  const factEvidence = assertFacts(facts, [firstFailure.runId!, secondFailure.runId!]);
  const diagnostics = await assertLocalDiagnostics([firstFailure, secondFailure]);
  const mainPageText = await desktop.page.locator("body").innerText();
  assertPublicBoundary(mainPageText, factEvidence.externalSessionId);

  await closeDesktop(desktop.application);
  desktop = null;
  restartedDesktop = await launchDesktop();
  await selectSession(restartedDesktop.page);
  await assertFailurePage(restartedDesktop.page, 2);

  const outputButtons = restartedDesktop.page.getByRole("button", { name: "完整输出" });
  if (await outputButtons.count() < 2) {
    throw new Error("Restarted page did not retain both process-output entry points");
  }
  await outputButtons.last().click();
  const processTab = restartedDesktop.page.getByTestId("process-tab");
  await processTab.waitFor({ timeout: 20_000 });
  const processText = await waitForText(
    processTab,
    (text) => text.includes("过程记录已不可用"),
    20_000,
  );
  if (!processText.includes("Kimi")) {
    throw new Error("Unavailable process view did not retain the Kimi provider label");
  }
  assertPublicBoundary(await restartedDesktop.page.locator("body").innerText(), factEvidence.externalSessionId);

  const restartedState = await getState(restartedDesktop.apiBase);
  const restartedFailures = emptyFailures(restartedState);
  if (
    restartedFailures.length !== 2
    || restartedFailures.some((message) =>
      message.runTiming?.engine !== "kimi"
      || message.runTiming.status !== "failed"
      || message.runTiming.elapsedMs === null)
  ) {
    throw new Error("Restarted page state did not preserve two independent failed Kimi attempts");
  }

  const evidence = {
    ok: true,
    status: "passed",
    generatedAt: new Date().toISOString(),
    entry: "production Electron desktop main conversation + real Kimi ACP CLI",
    marker,
    sessionId,
    assertions: {
      firstAttemptShowsSafeFailure: true,
      retryActionVisibleAndUsed: true,
      twoIndependentFailedAttempts: true,
      attemptsRetainKimiEngineAndElapsedTime: true,
      noBlankAgentResponse: true,
      providerSessionObserved: true,
      canonicalSessionRetained: true,
      retryUsesCanonicalResume: true,
      noReplacementSessionOrProviderFallback: true,
      noExecutionLinkForEitherAttempt: true,
      noTimelineCursorForEitherAttempt: true,
      restartRetainsBothFailures: true,
      unavailableProcessDoesNotUseCanonicalWire: true,
      publicPageExcludesRawDiagnostics: true,
      localBoundedDiagnosticRetained: true,
    },
    attempts: restartedFailures.map((message) => ({
      runId: message.runId,
      attempt: message.runTiming?.attempt,
      engine: message.runTiming?.engine,
      status: message.runTiming?.status,
      elapsedMs: message.runTiming?.elapsedMs,
      error: message.error,
      body: message.body,
    })),
    facts: {
      providerInvocationModes: factEvidence.invocationModes,
      observedSessionDigest: digest(factEvidence.externalSessionId),
      observationCount: factEvidence.observationCount,
      canonicalLinkCount: factEvidence.canonicalLinkCount,
      executionLinkCount: 0,
      timelineCursorCount: 0,
      agentResponseCount: 0,
    },
    diagnostics,
    pageSignals: {
      heading: "这一步没跑起来",
      body: SAFE_MESSAGE,
      retry: "重试",
      processUnavailable: "Kimi 过程记录已不可用",
    },
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`KIMI_EMPTY_RESPONSE_EVIDENCE=${evidencePath}\n`);
} finally {
  if (desktop !== null) {
    await closeDesktop(desktop.application);
  }
  if (restartedDesktop !== null) {
    await closeDesktop(restartedDesktop.application);
  }
}

type RuntimeMessage = {
  id: number;
  speaker: "user" | "agent" | "system";
  body: string;
  status: string;
  runId: string | null;
  runDir: string | null;
  error: string | null;
  runTiming?: {
    attempt: number;
    engine: string;
    status: string;
    elapsedMs: number | null;
  };
};

type RuntimeState = {
  messages: RuntimeMessage[];
  activeRuns: unknown[];
};

type FactEvent = {
  type: string;
  payload: Record<string, unknown>;
};

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
      MOEBIUS_DATA_ROOT: runtimeRoot,
      MOEBIUS_DISABLE_UPDATE_CHECK: "1",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  const apiBase = await waitFor(async () =>
    page.evaluate(async () => await window.moebius?.getLocalConsoleUrl?.() ?? null),
  30_000);
  await page.getByLabel("消息内容").waitFor({ timeout: 30_000 });
  return { application, page, apiBase };
}

async function closeDesktop(application: ElectronApplication): Promise<void> {
  const child = application.process();
  let timer: NodeJS.Timeout | null = null;
  await Promise.race([
    application.close().catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
        resolve();
      }, 10_000);
    }),
  ]);
  if (timer !== null) clearTimeout(timer);
}

async function selectSession(page: Page): Promise<void> {
  const sessionEntry = page.getByText(sessionTitle, { exact: true }).first();
  await sessionEntry.waitFor({ timeout: 30_000 });
  await sessionEntry.click();
  await page.getByLabel("消息内容").waitFor({ timeout: 20_000 });
}

async function sendFromMainConversation(page: Page, body: string): Promise<void> {
  const composer = page.getByLabel("消息内容");
  await composer.fill(body);
  await page.getByRole("button", { name: "发送消息" }).click();
}

async function getState(apiBase: string): Promise<RuntimeState> {
  const url = new URL("/api/local-console/state", apiBase);
  url.searchParams.set("sessionId", sessionId);
  url.searchParams.set("projectId", project.projectId);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`state failed: ${String(response.status)} ${await response.text()}`);
  }
  return await response.json() as RuntimeState;
}

async function waitForTerminalState(apiBase: string, timeoutMs: number): Promise<RuntimeState> {
  return await waitForState(
    apiBase,
    (state) =>
      state.activeRuns.length === 0
      && state.messages.some((message) =>
        message.speaker === "agent"
        || (message.speaker === "system" && message.status === "displayed")),
    timeoutMs,
  );
}

async function waitForState(
  apiBase: string,
  predicate: (state: RuntimeState) => boolean,
  timeoutMs: number,
): Promise<RuntimeState> {
  let latest: RuntimeState | null = null;
  try {
    return await waitFor(async () => {
      latest = await getState(apiBase);
      return predicate(latest) ? latest : null;
    }, timeoutMs);
  } catch (error) {
    throw new Error(`${String(error)}; latest=${JSON.stringify(latest)}`);
  }
}

function emptyFailures(state: RuntimeState): RuntimeMessage[] {
  return state.messages.filter((message) =>
    message.speaker === "system"
    && message.error === "kimi-empty-response"
    && message.status === "displayed");
}

async function assertFailurePage(page: Page, expectedCount: number): Promise<void> {
  await waitFor(async () =>
    await page.getByText(SAFE_MESSAGE, { exact: true }).count() === expectedCount
      ? true
      : null,
  30_000);
  await waitFor(async () =>
    await page.getByText("这一步没跑起来", { exact: true }).count() === expectedCount
      ? true
      : null,
  30_000);
  await waitFor(async () =>
    await page.getByRole("button", { name: "重试" }).count() === expectedCount
      ? true
      : null,
  30_000);
  const pageText = await page.locator("body").innerText();
  if (!pageText.includes("Kimi")) {
    throw new Error(`Kimi failure cards did not retain the member/provider identity: ${pageText}`);
  }
}

function assertFacts(
  facts: FactEvent[],
  runIds: [string, string],
): {
  externalSessionId: string;
  observationCount: number;
  canonicalLinkCount: number;
  invocationModes: string[];
} {
  const observations = facts.filter((fact) =>
    fact.type === "provider_session_observed"
    && runIds.includes(String(fact.payload.runId)));
  const externalIds = new Set(observations.map((fact) => String(fact.payload.externalSessionId)));
  if (observations.length !== 2 || externalIds.size !== 1) {
    throw new Error("Kimi attempts did not preserve one observed external session");
  }
  const externalSessionId = [...externalIds][0]!;
  const canonicalLinks = facts.filter((fact) =>
    fact.type === "agent_session_link"
    && fact.payload.externalSessionId === externalSessionId);
  const executionLinks = facts.filter((fact) =>
    fact.type === "execution_session_link"
    && runIds.includes(String(fact.payload.runId)));
  const cursors = facts.filter((fact) =>
    fact.type === "agent_timeline_cursor"
    && runIds.includes(String(fact.payload.runId)));
  const responses = facts.filter((fact) =>
    (fact.type === "record_agent_response" || fact.type === "record_detached_agent_response")
    && runIds.includes(String(fact.payload.runId)));
  const terminalInvocations = facts.filter((fact) =>
    fact.type === "provider_invocation"
    && runIds.includes(String(fact.payload.runId))
    && fact.payload.phase === "terminal");
  const startedInvocations = facts.filter((fact) =>
    fact.type === "provider_invocation"
    && runIds.includes(String(fact.payload.runId))
    && fact.payload.phase === "started");
  const invocationModes = startedInvocations.map((fact) => String(fact.payload.mode));
  if (
    canonicalLinks.length !== 1
    || executionLinks.length !== 0
    || cursors.length !== 0
    || responses.length !== 0
    || terminalInvocations.length !== 2
    || terminalInvocations.some((fact) => fact.payload.outcome !== "failed")
    || invocationModes.join(",") !== "full,resume"
    || startedInvocations[1]?.payload.requestedExternalSessionId !== externalSessionId
  ) {
    throw new Error("Kimi empty-response facts violated the canonical/no-execution-link contract");
  }
  return {
    externalSessionId,
    observationCount: observations.length,
    canonicalLinkCount: canonicalLinks.length,
    invocationModes,
  };
}

async function assertLocalDiagnostics(messages: RuntimeMessage[]): Promise<{
  fileCount: number;
  maxBytes: number;
  internalCode: string;
}> {
  const sizes: number[] = [];
  for (const message of messages) {
    if (message.runDir === null) {
      throw new Error("Kimi failed attempt did not retain its local run directory");
    }
    const stderrPath = path.join(message.runDir, "kimi-stderr.log");
    const [text, stat] = await Promise.all([
      fs.readFile(stderrPath, "utf8"),
      fs.stat(stderrPath),
    ]);
    if (!text.includes("KIMI_EMPTY_RESPONSE")) {
      throw new Error("Kimi local diagnostic omitted KIMI_EMPTY_RESPONSE");
    }
    if (stat.size > 1_048_576) {
      throw new Error("Kimi local diagnostic exceeded its acceptance bound");
    }
    sizes.push(stat.size);
  }
  return {
    fileCount: sizes.length,
    maxBytes: Math.max(...sizes),
    internalCode: "KIMI_EMPTY_RESPONSE",
  };
}

function assertPublicBoundary(text: string, externalSessionId: string): void {
  for (const forbidden of ["403", runtimeRoot, externalSessionId, "llm.request", "\"jsonrpc\""]) {
    if (text.includes(forbidden)) {
      throw new Error(`Public Kimi page exposed forbidden diagnostic content: ${forbidden}`);
    }
  }
}

async function readFacts(filePath: string): Promise<FactEvent[]> {
  return (await fs.readFile(filePath, "utf8"))
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as FactEvent);
}

async function waitForText(
  locator: { innerText(): Promise<string> },
  predicate: (text: string) => boolean,
  timeoutMs: number,
): Promise<string> {
  return await waitFor(async () => {
    const text = await locator.innerText();
    return predicate(text) ? text : null;
  }, timeoutMs);
}

async function waitFor<T>(
  read: () => Promise<T | null>,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== null) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for acceptance state${
    lastError === null ? "" : `: ${String(lastError)}`
  }`);
}

async function writePreconditionEvidence(state: RuntimeState, reason: string): Promise<void> {
  await fs.writeFile(evidencePath, `${JSON.stringify({
    ok: false,
    status: "precondition-not-reproduced",
    generatedAt: new Date().toISOString(),
    entry: "production Electron desktop main conversation + real Kimi ACP CLI",
    marker,
    reason,
    observedMessages: state.messages.map((message) => ({
      speaker: message.speaker,
      status: message.status,
      error: message.error,
      hasVisibleBody: message.body.trim().length > 0,
      engine: message.runTiming?.engine ?? null,
    })),
  }, null, 2)}\n`, "utf8");
  process.stdout.write(`KIMI_EMPTY_RESPONSE_EVIDENCE=${evidencePath}\n`);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
