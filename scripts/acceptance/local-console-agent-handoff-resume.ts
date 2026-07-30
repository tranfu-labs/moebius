import crypto from "node:crypto";
import { spawn } from "node:child_process";
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
import { createAcceptanceOutputDirectory } from "./temp-output.js";

interface Invocation {
  invocationId: string;
  mode: "full" | "resume";
  pid: number;
  role: string;
  threadId: string;
  prompt: string;
  startedAt: string;
}

interface MessageSnapshot {
  id: number;
  speaker: string;
  role: string | null;
  body: string;
  status: string;
  runId: string | null;
  runDir: string | null;
  error: string | null;
  sourceKind: string | null;
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RunSnapshot {
  runId: string;
  role: string | null;
  stepId: string;
  attempt: number;
}

interface StateSnapshot {
  messages: MessageSnapshot[];
  activeRuns: RunSnapshot[];
  pendingDispatchMessages: Array<{
    message: MessageSnapshot;
    targetLane: string;
    targetRole: string | null;
  }>;
}

interface FactEvent {
  type: string;
  payload?: Record<string, unknown>;
  messageUpserts?: MessageSnapshot[];
}

const sourceDataRoot = "/Users/wing/Develop/agent-moebius";
const targetSessionId = "local:2026-07-29T09:16:04.958Z-5hsb8c";
const targetSessionFile = "bG9jYWw6MjAyNi0wNy0yOVQwOToxNjowNC45NThaLTVoc2I4Yw.jsonl";
const targetRunId = "local-2026-07-29T12:57:06.414Z-ua0g4yza";
const targetSourceMessageId = 404;
const targetProviderId = "019fad8a-983e-7941-a87d-c97845683e3c";
const managerProviderId = "019fad28-f1c4-7151-a559-cfeda0a4f2f3";
const preservedMessageIds = [412, 413, 414, 415];
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(projectRoot, "desktop");
const evidenceRoot = await createAcceptanceOutputDirectory("local-console-agent-handoff-resume");
const copyParent = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-agent-handoff-data-copy-"));
const copiedDataRoot = path.join(copyParent, "data-root");
const controlRoot = path.join(copyParent, "control");
const shimBin = path.join(copyParent, "bin");
const codexHome = path.join(copyParent, "codex-home");
const invocationLog = path.join(controlRoot, "invocations.jsonl");
const evidencePath = path.join(evidenceRoot, "evidence.json");
const qaHold = path.join(controlRoot, "hold-original-qa");
const managerHold = path.join(controlRoot, "hold-fresh-manager");
const qaRelease = path.join(controlRoot, "release-original-qa");
const managerRelease = path.join(controlRoot, "release-fresh-manager");
const assertions: Array<{ id: string; passed: boolean; observed: unknown }> = [];
let desktop: { application: ElectronApplication; page: Page; apiBase: string } | null = null;
let passed = false;

function assertEvidence(id: string, condition: boolean, observed: unknown): void {
  assertions.push({ id, passed: condition, observed });
  if (!condition) {
    throw new Error(`Acceptance assertion failed: ${id}: ${JSON.stringify(observed)}`);
  }
}

function historicalStableSummary(messages: readonly MessageSnapshot[]): Array<{
  id: number;
  body: string;
  status: string;
  runId: string | null;
  error: string | null;
}> {
  return messages.map((message) => ({
    id: message.id,
    body: message.body,
    status: message.status,
    runId: message.runId,
    error: message.error,
  }));
}

const originalManifestBefore = await persistentManifest(sourceDataRoot);
await run("cp", ["-cR", sourceDataRoot, copiedDataRoot]);
for (const singletonName of ["SingletonCookie", "SingletonLock", "SingletonSocket"]) {
  await fs.rm(
    path.join(copiedDataRoot, ".state", "desktop-user-data", singletonName),
    { force: true },
  );
}
await fs.mkdir(controlRoot, { recursive: true });
await fs.mkdir(shimBin, { recursive: true });
await fs.mkdir(codexHome, { recursive: true });
await fs.writeFile(invocationLog, "", "utf8");
await fs.writeFile(qaHold, "hold\n", "utf8");
await fs.writeFile(managerHold, "hold\n", "utf8");
await writeCodexShim();
await writeProviderRollouts();

const copiedFactLog = path.join(copiedDataRoot, "sessions", targetSessionFile);
const factBytesBefore = await fs.readFile(copiedFactLog);
const factsBefore = parseFacts(factBytesBefore);
const messagesBefore = latestAllMessages(factsBefore);
const contextConflictCountBefore = messagesBefore.filter((message) =>
  message.error?.includes("conflicting run_execution_context") === true).length;
const runNotStartedCountBefore = messagesBefore.filter((message) =>
  message.body.includes("这一步没跑起来")).length;
const historicalBefore = historicalStableSummary(
  latestMessages(factsBefore, preservedMessageIds),
);
const sourceBefore = latestMessages(factsBefore, [targetSourceMessageId])[0];
const cursorBefore = readCursor(copiedDataRoot);
const targetContext = factsBefore.find((event) =>
  event.type === "run_execution_context"
  && event.payload?.runId === targetRunId)?.payload;
const targetLifecycle = factsBefore.find((event) =>
  event.type === "run_lifecycle"
  && event.payload?.runId === targetRunId
  && event.payload?.phase === "created")?.payload;
const targetIntent = factsBefore.find((event) =>
  event.type === "codex_resume_intent"
  && event.payload?.targetRunId === targetRunId
  && event.payload?.reason === "graceful-shutdown")?.payload;

try {
  desktop = await launchDesktop();
  const originalResume = (await waitFor(async () => {
    const invocations = await readInvocations();
    return invocations.find((entry) =>
      entry.mode === "resume" && entry.threadId === targetProviderId) ?? null;
  }, 120_000));
  const qaRunning = await waitForState((state) =>
    state.activeRuns.some((run) => run.runId === targetRunId && run.role === "qa"));
  const qaRun = qaRunning.activeRuns.find((run) => run.runId === targetRunId)!;
  const factsAfterRepair = parseFacts(await fs.readFile(copiedFactLog));
  const repairFacts = factsAfterRepair.filter((event) =>
    event.type === "repair_agent_handoff_resume_source"
    && event.payload?.targetRunId === targetRunId
    && event.payload?.sourceMessageId === targetSourceMessageId);
  const sourceAfterRepair = latestMessages(factsAfterRepair, [targetSourceMessageId])[0];
  const historicalAfterRepair = historicalStableSummary(
    latestMessages(factsAfterRepair, preservedMessageIds),
  );

  assertEvidence("complete-copy-used", copiedDataRoot.startsWith(os.tmpdir()), copiedDataRoot);
  assertEvidence("repair-fact-once", repairFacts.length === 1, repairFacts);
  assertEvidence(
    "exact-source-restored-without-history-rewrite",
    sourceBefore?.status === "pending"
      && sourceAfterRepair?.status === "displayed"
      && JSON.stringify(historicalAfterRepair) === JSON.stringify(historicalBefore)
      && (await fs.readFile(copiedFactLog)).subarray(0, factBytesBefore.length).equals(factBytesBefore),
    { sourceBefore, sourceAfterRepair, historicalBefore, historicalAfterRepair },
  );
  assertEvidence(
    "same-run-step-attempt-role-provider",
    qaRun.runId === targetRunId
      && qaRun.stepId === targetLifecycle?.stepId
      && qaRun.attempt === targetLifecycle?.attempt
      && qaRun.role === targetContext?.role
      && targetContext?.sourceMessageId === targetSourceMessageId
      && originalResume.mode === "resume"
      && originalResume.threadId === targetProviderId,
    { qaRun, targetContext, targetLifecycle, originalResume },
  );

  const sessionTitle = await sessionTitleFromDatabase(copiedDataRoot);
  await sendFromMainConversation(desktop.page, sessionTitle, "继续 FRESH-CONTINUE");
  const freshManager = await waitFor(async () => {
    const invocations = await readInvocations();
    return invocations.find((entry) => entry.prompt.includes("FRESH-CONTINUE")) ?? null;
  }, 20_000);
  const duringParallel = await waitForState((state) =>
    state.activeRuns.some((run) => run.runId === targetRunId && run.role === "qa")
    && state.activeRuns.some((run) => run.role === "dev-manager" && run.runId !== targetRunId));
  const freshUser = duringParallel.messages.find((message) =>
    message.speaker === "user" && message.body === "继续 FRESH-CONTINUE");
  const freshRun = duringParallel.activeRuns.find((run) =>
    run.role === "dev-manager" && run.runId !== targetRunId);
  assertEvidence(
    "fresh-continue-exact-source-isolated",
    freshUser !== undefined
      && freshRun !== undefined
      && freshRun.runId !== targetRunId
      && freshUser.runId === freshRun.runId
      && freshManager.mode === "resume"
      && freshManager.threadId === managerProviderId,
    { freshUser, freshRun, freshManager, activeRuns: duringParallel.activeRuns },
  );

  await fs.writeFile(managerRelease, "release\n", "utf8");
  await fs.rm(managerHold, { force: true });
  const managerCompleted = await waitForState((state) =>
    state.messages.some((message) =>
      message.speaker === "agent" && message.body.includes("DEV-MANAGER-FRESH-CONTINUE")));
  await desktop.page.getByText("DEV-MANAGER-FRESH-CONTINUE", { exact: false }).first().waitFor();
  await fs.writeFile(qaRelease, "release\n", "utf8");
  await fs.rm(qaHold, { force: true });
  const completed = await waitForState((state) =>
    state.messages.some((message) =>
      message.speaker === "agent" && message.body.includes("QA-LEGACY-RESUMED"))
    && state.activeRuns.length === 0
    && state.pendingDispatchMessages.length === 0);
  await desktop.page.getByText("QA-LEGACY-RESUMED", { exact: false }).first().waitFor();

  const finalFacts = parseFacts(await fs.readFile(copiedFactLog));
  const freshContext = finalFacts.find((event) =>
    event.type === "run_execution_context"
    && event.payload?.runId === freshRun?.runId)?.payload;
  const targetStartedInvocations = finalFacts.filter((event) =>
    event.type === "provider_invocation"
    && event.payload?.runId === targetRunId
    && event.payload?.phase === "started");
  assertEvidence(
    "provider-and-context-identity",
    freshContext?.sourceMessageId === freshUser?.id
      && freshContext?.role === "dev-manager"
      && targetStartedInvocations.filter((event) => event.payload?.mode === "full").length === 0
      && targetStartedInvocations.filter((event) =>
        event.payload?.mode === "resume"
        && event.payload?.requestedExternalSessionId === targetProviderId).length >= 1,
    { freshContext, targetStartedInvocations },
  );
  assertEvidence(
    "visible-completion-without-conflict",
    managerCompleted.messages.some((message) => message.body.includes("DEV-MANAGER-FRESH-CONTINUE"))
      && completed.messages.some((message) => message.body.includes("QA-LEGACY-RESUMED"))
      && completed.messages.filter((message) =>
        message.error?.includes("conflicting run_execution_context") === true).length
        === contextConflictCountBefore
      && completed.messages.filter((message) =>
        message.body.includes("这一步没跑起来")).length
        === runNotStartedCountBefore,
    {
      visibleSignals: ["DEV-MANAGER-FRESH-CONTINUE", "QA-LEGACY-RESUMED"],
      activeRuns: completed.activeRuns,
      pending: completed.pendingDispatchMessages,
      contextConflictCountBefore,
      runNotStartedCountBefore,
    },
  );

  await desktop.application.close();
  desktop = null;
  const repairCountBeforeRepeat = finalFacts.filter((event) =>
    event.type === "repair_agent_handoff_resume_source"
    && event.payload?.targetRunId === targetRunId).length;
  desktop = await launchDesktop();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const repeatedFacts = parseFacts(await fs.readFile(copiedFactLog));
  const repairCountAfterRepeat = repeatedFacts.filter((event) =>
    event.type === "repair_agent_handoff_resume_source"
    && event.payload?.targetRunId === targetRunId).length;
  assertEvidence(
    "repeat-startup-idempotent",
    repairCountBeforeRepeat === 1 && repairCountAfterRepeat === 1,
    { repairCountBeforeRepeat, repairCountAfterRepeat },
  );
  await desktop.application.close();
  desktop = null;

  const originalManifestAfter = await persistentManifest(sourceDataRoot);
  assertEvidence(
    "original-data-root-unwritten",
    JSON.stringify(originalManifestAfter) === JSON.stringify(originalManifestBefore),
    { before: originalManifestBefore, after: originalManifestAfter },
  );
  passed = true;

  const evidence = {
    generatedAt: new Date().toISOString(),
    sourceDataRoot,
    copiedDataRoot,
    targetSessionId,
    targetRunId,
    targetSourceMessageId,
    targetProviderId,
    originalManifestBefore,
    originalManifestAfter,
    before: {
      source: sourceBefore,
      cursor: cursorBefore,
      historical: historicalBefore,
      context: targetContext,
      lifecycle: targetLifecycle,
      intent: targetIntent,
      contextConflictCount: contextConflictCountBefore,
      runNotStartedCount: runNotStartedCountBefore,
    },
    after: {
      source: latestMessages(repeatedFacts, [targetSourceMessageId])[0],
      cursor: readCursor(copiedDataRoot),
      historical: historicalStableSummary(latestMessages(repeatedFacts, preservedMessageIds)),
      repairFactCount: repairCountAfterRepeat,
      invocations: await readInvocations(),
      freshContext,
      visibleMessages: completed.messages.filter((message) =>
        message.body.includes("DEV-MANAGER-FRESH-CONTINUE")
        || message.body.includes("QA-LEGACY-RESUMED")),
      contextConflictCount: completed.messages.filter((message) =>
        message.error?.includes("conflicting run_execution_context") === true).length,
      runNotStartedCount: completed.messages.filter((message) =>
        message.body.includes("这一步没跑起来")).length,
      replacementFullCount: targetStartedInvocations.filter((event) =>
        event.payload?.mode === "full").length,
    },
    assertions,
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
} finally {
  await desktop?.application.close().catch(() => undefined);
  console.log(JSON.stringify({
    passed,
    evidencePath,
    copiedDataRoot,
    assertionCount: assertions.length,
  }));
}

async function launchDesktop(): Promise<{ application: ElectronApplication; page: Page; apiBase: string }> {
  const application = await electron.launch({
    args: [desktopRoot],
    cwd: desktopRoot,
    env: {
      ...process.env,
      PATH: `${shimBin}${path.delimiter}${process.env.PATH ?? ""}`,
      CODEX_HOME: codexHome,
      MOEBIUS_DATA_ROOT: copiedDataRoot,
      MOEBIUS_DISABLE_UPDATE_CHECK: "1",
    },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  const apiBase = await waitFor(async () =>
    page.evaluate(async () => await window.moebius?.getLocalConsoleUrl?.() ?? null));
  await page.getByLabel("消息内容").waitFor();
  return { application, page, apiBase };
}

async function sendFromMainConversation(page: Page, title: string, body: string): Promise<void> {
  const sessionEntry = page.getByText(title, { exact: true }).first();
  await sessionEntry.waitFor();
  await sessionEntry.click();
  const composer = page.getByLabel("消息内容");
  await composer.fill(body);
  await page.getByRole("button", { name: "发送消息" }).click();
}

async function waitForState(predicate: (state: StateSnapshot) => boolean): Promise<StateSnapshot> {
  if (desktop === null) throw new Error("desktop is not running");
  return await waitFor(async () => {
    const url = new URL("/api/local-console/state", desktop!.apiBase);
    url.searchParams.set("sessionId", targetSessionId);
    const response = await fetch(url);
    if (!response.ok) return null;
    const state = await response.json() as StateSnapshot;
    return predicate(state) ? state : null;
  }, 20_000);
}

async function readInvocations(): Promise<Invocation[]> {
  const text = await fs.readFile(invocationLog, "utf8");
  return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as Invocation);
}

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 10_000): Promise<T> {
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
  throw new Error(`Timed out waiting for acceptance signal${lastError === null ? "" : `: ${String(lastError)}`}`);
}

function parseFacts(content: Buffer): FactEvent[] {
  return content.toString("utf8").trimEnd().split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FactEvent);
}

function latestMessages(events: FactEvent[], ids: number[]): MessageSnapshot[] {
  const selected = new Map<number, MessageSnapshot>();
  for (const event of events) {
    for (const message of event.messageUpserts ?? []) {
      if (ids.includes(message.id)) selected.set(message.id, message);
    }
  }
  return ids.map((id) => selected.get(id)).filter((value): value is MessageSnapshot => value !== undefined);
}

function latestAllMessages(events: FactEvent[]): MessageSnapshot[] {
  const selected = new Map<number, MessageSnapshot>();
  for (const event of events) {
    for (const message of event.messageUpserts ?? []) {
      selected.set(message.id, message);
    }
  }
  return [...selected.values()].sort((left, right) => left.id - right.id);
}

function readCursor(dataRoot: string): unknown {
  const database = new DatabaseSync(path.join(dataRoot, ".state", "local-console.sqlite"), { readOnly: true });
  try {
    return database.prepare(
      `SELECT processed_through_message_id AS processedThroughMessageId,
              active_message_id AS activeMessageId,
              active_run_id AS activeRunId
       FROM local_message_cursors
       WHERE session_id = ?`,
    ).get(targetSessionId);
  } finally {
    database.close();
  }
}

async function sessionTitleFromDatabase(dataRoot: string): Promise<string> {
  const database = new DatabaseSync(path.join(dataRoot, ".state", "local-console.sqlite"), { readOnly: true });
  try {
    const row = database.prepare(
      "SELECT title FROM sessions WHERE session_id = ?",
    ).get(targetSessionId) as { title?: unknown } | undefined;
    if (typeof row?.title !== "string") throw new Error("target session title not found");
    return row.title;
  } finally {
    database.close();
  }
}

async function persistentManifest(dataRoot: string): Promise<Array<{ path: string; size: number; sha256: string }>> {
  const files = [
    path.join("sessions", targetSessionFile),
  ];
  for (const relativeRoot of [path.join(".state", "agent-teams"), "teams"]) {
    await collectFiles(path.join(dataRoot, relativeRoot), relativeRoot, files);
  }
  for (const name of [".onboarding-completed", "last-used-team.json"]) {
    try {
      const stat = await fs.stat(path.join(dataRoot, name));
      if (stat.isFile()) files.push(name);
    } catch {
      // Optional data-root metadata.
    }
  }
  const databaseSnapshot = await targetSessionDatabaseSnapshot(dataRoot);
  const databaseBytes = Buffer.from(JSON.stringify(databaseSnapshot));
  const manifest = [{
    path: path.join(".state", "local-console.sqlite#target-session-logical"),
    size: databaseBytes.length,
    sha256: crypto.createHash("sha256").update(databaseBytes).digest("hex"),
  }];
  for (const relativePath of files.sort()) {
    if (relativePath.endsWith("-wal") || relativePath.endsWith("-shm")) continue;
    const content = await fs.readFile(path.join(dataRoot, relativePath));
    manifest.push({
      path: relativePath,
      size: content.length,
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
    });
  }
  return manifest;
}

async function targetSessionDatabaseSnapshot(dataRoot: string): Promise<Array<{
  table: string;
  rows: unknown[];
}>> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return readTargetSessionDatabaseSnapshot(dataRoot);
    } catch (error) {
      if (
        attempt === 5
        || !(error instanceof Error)
        || !error.message.includes("database is locked")
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  throw new Error("target session database snapshot retries exhausted");
}

function readTargetSessionDatabaseSnapshot(dataRoot: string): Array<{
  table: string;
  rows: unknown[];
}> {
  const database = new DatabaseSync(
    path.join(dataRoot, ".state", "local-console.sqlite"),
    { readOnly: true },
  );
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    const tables = (database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all() as Array<{ name: string }>).filter(({ name }) => {
      const quoted = quoteSqliteIdentifier(name);
      return (database.prepare(`PRAGMA table_info(${quoted})`).all() as Array<{ name: string }>)
        .some((column) => column.name === "session_id");
    });
    return tables.map(({ name }) => {
      const quoted = quoteSqliteIdentifier(name);
      const rows = database.prepare(
        `SELECT * FROM ${quoted} WHERE session_id = ?`,
      ).all(targetSessionId);
      return {
        table: name,
        rows: rows.sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right))),
      };
    });
  } finally {
    database.close();
  }
}

function quoteSqliteIdentifier(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

async function collectFiles(absoluteRoot: string, relativeRoot: string, output: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(absoluteRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const relativePath = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(path.join(absoluteRoot, entry.name), relativePath, output);
    } else if (entry.isFile()) {
      output.push(relativePath);
    }
  }
}

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${String(code)}`));
    });
  });
}

async function writeProviderRollouts(): Promise<void> {
  const rolloutDir = path.join(codexHome, "sessions", "2026", "07", "29");
  await fs.mkdir(rolloutDir, { recursive: true });
  for (const providerId of [targetProviderId, managerProviderId]) {
    await fs.writeFile(
      path.join(rolloutDir, `rollout-acceptance-${providerId}.jsonl`),
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        type: "session_meta",
        payload: {
          id: providerId,
          cwd: projectRoot,
          model_provider: "shim",
          cli_version: "0.145.0",
          base_instructions: { text: "agent handoff acceptance" },
        },
      })}\n`,
      "utf8",
    );
  }
}

async function writeCodexShim(): Promise<void> {
  const shimPath = path.join(shimBin, "codex");
  const source = `#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
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
const role = threadId === ${JSON.stringify(targetProviderId)}
  ? "qa"
  : prompt.includes("FRESH-CONTINUE")
    ? "dev-manager"
    : "unknown";
const invocation = {
  invocationId: crypto.randomUUID(),
  mode,
  pid: process.pid,
  role,
  threadId,
  prompt,
  startedAt: new Date().toISOString(),
};
fs.appendFileSync(${JSON.stringify(invocationLog)}, JSON.stringify(invocation) + "\\n");
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: threadId }) + "\\n");
const holdPath = role === "qa" ? ${JSON.stringify(qaHold)} : ${JSON.stringify(managerHold)};
const releasePath = role === "qa" ? ${JSON.stringify(qaRelease)} : ${JSON.stringify(managerRelease)};
const finish = () => {
  const text = role === "qa" ? "QA-LEGACY-RESUMED" : "DEV-MANAGER-FRESH-CONTINUE";
  process.stdout.write(JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text },
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "turn.completed",
    usage: { cached_input_tokens: 0 },
  }) + "\\n");
};
if (!fs.existsSync(holdPath) || fs.existsSync(releasePath)) {
  finish();
  process.exit(0);
}
const timer = setInterval(() => {
  if (fs.existsSync(releasePath)) {
    clearInterval(timer);
    finish();
    process.exit(0);
  }
}, 25);
`;
  await fs.writeFile(shimPath, source, { encoding: "utf8", mode: 0o755 });
}
