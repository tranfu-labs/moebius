import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CodexRunOptions, CodexRunResult } from "../../src/codex.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../../src/local-console/start.js";
import { createSqliteLocalConsoleStore } from "../../src/local-console/store.js";
import type {
  LocalConsoleSessionSummary,
  LocalConsoleStore,
} from "../../src/local-console/types.js";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

interface LocalStateResponse {
  selectedSessionId: string;
  messages: Array<{ speaker: string; role: string | null; body: string; status: string; error: string | null; runDir: string | null }>;
  activeRun: { sessionId: string; runId: string; runDir: string | null; lastOutputSummary: string; interruptible: boolean } | null;
}

interface Evidence {
  acceptance: Array<{ id: number; statement: string; evidence: unknown }>;
  artifacts: { evidence: string };
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const artifactDir = await createAcceptanceOutputDirectory("local-console-t45");
const evidencePath = path.join(artifactDir, "t45-evidence.json");

async function main(): Promise<void> {
  await fs.mkdir(artifactDir, { recursive: true });

  const chain = await runHandoffChainScenario();
  const restart = await runRestartScenario();
  const recordFailure = await runRecordFailureScenario();
  const stuck = await runStuckScenario();
  const multiSession = await runMultiSessionScenario();

  const evidence: Evidence = {
    artifacts: { evidence: evidencePath },
    acceptance: [
      {
        id: 1,
        statement: "本地发送 @ceo 我想做 X 后应按 ceo -> dev-manager -> dev -> qa 顺序落库",
        evidence: {
          agentRoles: chain.agentRoles,
          runRoles: chain.runRoles,
        },
      },
      {
        id: 2,
        statement: "相邻 handoff 不应有固定 1s+ poll 等待",
        evidence: {
          runGapsMs: chain.runGapsMs,
          maxRunGapMs: Math.max(...chain.runGapsMs),
        },
      },
      {
        id: 3,
        statement: "重启后从 SQLite cursor 续跑，不重复已完成 role、不丢剩余 handoff",
        evidence: restart,
      },
      {
        id: 4,
        statement: "recordAgentResponse 事务前失败不推进 cursor，且不出现半条 agent 回复",
        evidence: recordFailure,
      },
      {
        id: 5,
        statement: "agent 回复提交后、下一棒 claim 前退出，重启后从该 agent 回复继续下一棒",
        evidence: restart,
      },
      {
        id: 6,
        statement: "handoff 中段 timeout 后记录 visible stuck，释放 session，cursor active 不永久挡住后续消息",
        evidence: stuck,
      },
      {
        id: 7,
        statement: "两个 session startup catch-up 时，慢 session A 不阻塞 session B",
        evidence: multiSession,
      },
    ],
  };

  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, evidence: evidencePath })}\n`);
}

async function runHandoffChainScenario(): Promise<{ agentRoles: Array<string | null>; runRoles: string[]; runGapsMs: number[] }> {
  const root = await makeRoot("chain");
  await writeAgents(root, ["ceo", "dev-manager", "dev", "qa"]);
  const calls: Array<{ role: string; at: number }> = [];
  const started = await startLocalConsoleServer({
    projectRoot: root,
    port: 0,
    runCodex: async (options) => {
      const role = roleFromPrompt(options.prompt);
      calls.push({ role, at: Date.now() });
      return codexOk(options, {
        ceo: "@dev-manager please review",
        "dev-manager": "@dev please implement",
        dev: "@qa please test",
        qa: "QA done",
      }[role] ?? "done");
    },
    makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
  });
  try {
    const session = await createSession(started.url, "chain");
    await postMessage(started.url, session.sessionId, "@ceo 我想做 X");
    const state = await waitForState(started.url, session.sessionId, (data) =>
      data.messages.filter((entry) => entry.speaker === "agent").length === 4,
    );
    return {
      agentRoles: state.messages.filter((entry) => entry.speaker === "agent").map((entry) => entry.role),
      runRoles: calls.map((entry) => entry.role),
      runGapsMs: calls.slice(1).map((entry, index) => entry.at - calls[index]!.at),
    };
  } finally {
    await started.close();
  }
}

async function runRestartScenario(): Promise<{ agentRoles: Array<string | null>; runCountAfterRestart: number }> {
  const root = await makeRoot("restart");
  await writeAgents(root, ["dev"]);
  const sqlitePath = path.join(root, ".state", "local-console.sqlite");
  const store = await createSqliteLocalConsoleStore({ sqlitePath });
  await store.init();
  const session = await store.createSession({ sessionId: "local:restart", title: "restart", now: now(0) });
  const user = await store.appendUserMessage({ sessionId: session.sessionId, body: "@ceo first", now: now(1) });
  await store.claimNextPendingMessage({ sessionId: session.sessionId, runId: "run-ceo", now: now(2) });
  await store.recordAgentResponse({
    userMessageId: user.id,
    sessionId: session.sessionId,
    role: "ceo",
    body: "@dev continue",
    runId: "run-ceo",
    runDir: path.join(root, "runs", "ceo"),
    processSteps: [],
    now: now(3),
  });
  await store.close();

  const runCalls: string[] = [];
  const started = await startLocalConsoleServer({
    projectRoot: root,
    sqlitePath,
    port: 0,
    runCodex: async (options) => {
      runCalls.push(roleFromPrompt(options.prompt));
      return codexOk(options, "dev done");
    },
    makeRunDir: (count) => path.join(root, "runs", `restart-${String(count)}`),
  });
  try {
    const state = await waitForState(started.url, session.sessionId, (data) =>
      data.messages.some((entry) => entry.speaker === "agent" && entry.role === "dev"),
    );
    return {
      agentRoles: state.messages.filter((entry) => entry.speaker === "agent").map((entry) => entry.role),
      runCountAfterRestart: runCalls.length,
    };
  } finally {
    await started.close();
  }
}

async function runRecordFailureScenario(): Promise<{ runCount: number; agentsAfterFailure: number; agentsAfterRetry: number; pendingAfterFailure: boolean }> {
  const root = await makeRoot("record-failure");
  await writeAgents(root, ["dev"]);
  const innerStore = await createSqliteLocalConsoleStore({ sqlitePath: path.join(root, ".state", "local-console.sqlite") });
  const store = createFailOnceRecordAgentResponseStore(innerStore);
  const runCalls: string[] = [];
  const started = await startLocalConsoleServer({
    projectRoot: root,
    port: 0,
    store,
    runCodex: async (options) => {
      runCalls.push(roleFromPrompt(options.prompt));
      return codexOk(options, "dev done");
    },
    makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
  });
  try {
    const session = await createSession(started.url, "record failure");
    await postMessage(started.url, session.sessionId, "@dev retry me");
    await waitFor(() => runCalls.length === 1);
    const afterFailure = await waitForState(started.url, session.sessionId, (data) =>
      data.messages.some((entry) => entry.speaker === "user" && entry.status === "pending"),
    );
    await started.runtime.processPending(session.sessionId);
    const afterRetry = await waitForState(started.url, session.sessionId, (data) =>
      data.messages.some((entry) => entry.speaker === "agent" && entry.role === "dev"),
    );
    return {
      runCount: runCalls.length,
      agentsAfterFailure: afterFailure.messages.filter((entry) => entry.speaker === "agent").length,
      agentsAfterRetry: afterRetry.messages.filter((entry) => entry.speaker === "agent").length,
      pendingAfterFailure: afterFailure.messages.some((entry) => entry.speaker === "user" && entry.status === "pending"),
    };
  } finally {
    await started.close();
  }
}

async function runStuckScenario(): Promise<{ stuckRecords: unknown[]; qaContinued: boolean }> {
  const root = await makeRoot("stuck");
  await writeAgents(root, ["ceo", "dev", "qa"]);
  const started = await startLocalConsoleServer({
    projectRoot: root,
    port: 0,
    runCodex: async (options) => {
      const role = roleFromPrompt(options.prompt);
      if (role === "ceo") {
        return codexOk(options, "@dev continue");
      }
      if (role === "dev") {
        return {
          ok: false,
          reason: "max-duration-timeout:20ms",
          runDir: options.runDir,
          stdoutPath: path.join(options.runDir, "stdout.jsonl"),
          stderrPath: path.join(options.runDir, "stderr.log"),
        };
      }
      return codexOk(options, "qa after stuck");
    },
    makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
    codexMaxDurationMs: 20,
  });
  try {
    const session = await createSession(started.url, "stuck");
    await postMessage(started.url, session.sessionId, "@ceo start");
    const stuckState = await waitForState(started.url, session.sessionId, (data) =>
      data.messages.some((entry) => entry.status === "stuck"),
    );
    await postMessage(started.url, session.sessionId, "@qa after stuck");
    const continued = await waitForState(started.url, session.sessionId, (data) =>
      data.messages.some((entry) => entry.speaker === "agent" && entry.role === "qa"),
    );
    return {
      stuckRecords: stuckState.messages.filter((entry) => entry.status === "stuck").map((entry) => ({
        speaker: entry.speaker,
        role: entry.role,
        body: entry.body,
        status: entry.status,
        error: entry.error,
        hasRunDir: entry.runDir !== null,
      })),
      qaContinued: continued.messages.some((entry) => entry.speaker === "agent" && entry.role === "qa"),
    };
  } finally {
    await started.close();
  }
}

async function runMultiSessionScenario(): Promise<{ fastSessionAgents: Array<string | null>; slowActiveBeforeInterrupt: boolean }> {
  const root = await makeRoot("multi-session");
  await writeAgents(root, ["dev"]);
  const sqlitePath = path.join(root, ".state", "local-console.sqlite");
  const store = await createSqliteLocalConsoleStore({ sqlitePath });
  await store.init();
  const sessionA = await store.createSession({ sessionId: "local:slow-a", title: "slow A", now: now(0) });
  const sessionB = await store.createSession({ sessionId: "local:fast-b", title: "fast B", now: now(0) });
  await store.appendUserMessage({ sessionId: sessionA.sessionId, body: "@dev slow startup", now: now(1) });
  await store.appendUserMessage({ sessionId: sessionB.sessionId, body: "@dev fast startup", now: now(2) });
  await store.close();

  const started = await startLocalConsoleServer({
    projectRoot: root,
    sqlitePath,
    port: 0,
    runCodex: (options) => {
      if (options.prompt.includes("slow startup")) {
        return waitForAbortResult(options);
      }
      return Promise.resolve(codexOk(options, "fast done"));
    },
    makeRunDir: (count) => path.join(root, "runs", `startup-${String(count)}`),
  });
  try {
    const fast = await waitForState(started.url, sessionB.sessionId, (data) =>
      data.messages.some((entry) => entry.speaker === "agent" && entry.body === "fast done"),
    );
    const slow = await waitForState(started.url, sessionA.sessionId, (data) => data.activeRun !== null);
    await interrupt(started.url, sessionA.sessionId, slow.activeRun?.runId ?? "");
    await waitForState(started.url, sessionA.sessionId, (data) =>
      data.messages.some((entry) => entry.status === "interrupted"),
    );
    return {
      fastSessionAgents: fast.messages.filter((entry) => entry.speaker === "agent").map((entry) => entry.role),
      slowActiveBeforeInterrupt: slow.activeRun !== null,
    };
  } finally {
    await started.close();
  }
}

async function makeRoot(label: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `moebius-t45-${label}-`));
}

async function writeAgents(root: string, roles: string[]): Promise<void> {
  await Promise.all(roles.map((role) => writeAgent(root, role, `# ${role}\n\nROLE:${role}`)));
}

async function writeAgent(root: string, name: string, body: string): Promise<void> {
  const dir = path.join(root, "agents");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${name}.md`), body, "utf8");
}

async function createSession(url: string, title: string): Promise<LocalConsoleSessionSummary> {
  const response = await fetch(new URL("/api/local-console/sessions", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (response.status !== 201) {
    throw new Error(`create session failed: ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { session: LocalConsoleSessionSummary }).session;
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

async function getState(url: string, sessionId: string): Promise<LocalStateResponse> {
  const stateUrl = new URL("/api/local-console/state", url);
  stateUrl.searchParams.set("sessionId", sessionId);
  const response = await fetch(stateUrl);
  if (response.status !== 200) {
    throw new Error(`get state failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as LocalStateResponse;
}

async function waitForState(
  url: string,
  sessionId: string,
  predicate: (state: LocalStateResponse) => boolean,
): Promise<LocalStateResponse> {
  let latest: LocalStateResponse | null = null;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    latest = await getState(url, sessionId);
    if (predicate(latest)) {
      return latest;
    }
    await sleep(20);
  }
  throw new Error(`Timed out waiting for state: ${JSON.stringify(latest)}`);
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await sleep(20);
  }
  throw new Error("Timed out waiting for condition");
}

async function interrupt(url: string, sessionId: string, runId: string): Promise<void> {
  const response = await fetch(new URL(`/api/local-console/sessions/${encodeURIComponent(sessionId)}/interrupt`, url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId }),
  });
  if (response.status !== 202) {
    throw new Error(`interrupt failed: ${response.status} ${await response.text()}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function roleFromPrompt(prompt: string): string {
  for (const role of ["ceo", "dev-manager", "dev", "qa"]) {
    if (prompt.includes(`ROLE:${role}`)) {
      return role;
    }
  }
  throw new Error(`Unable to detect role from prompt: ${prompt.slice(0, 160)}`);
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

function waitForAbortResult(options: CodexRunOptions): Promise<CodexRunResult> {
  return new Promise<CodexRunResult>((resolve) => {
    options.signal?.addEventListener(
      "abort",
      () => {
        resolve({
          ok: false,
          reason: `interrupted:${String(options.signal?.reason ?? "abort")}`,
          runDir: options.runDir,
          stdoutPath: path.join(options.runDir, "stdout.jsonl"),
          stderrPath: path.join(options.runDir, "stderr.log"),
        });
      },
      { once: true },
    );
  });
}

function now(offset: number): string {
  return new Date(Date.UTC(2026, 6, 9, 0, 0, offset)).toISOString();
}

/**
 * 全量委托包装：inner 上有什么就有什么——接口内、LocalSessionFactWritingStore
 * 这类接口外扩展、以及未来新增的成员全部自动跟随，能力探测（store.X !==
 * undefined）得到正确答案；只有 overrides 里的行为被替换。函数绑定 inner
 * 保留 this。
 */
function wrapStore<T extends object>(inner: T, overrides: Partial<T>): T {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop in overrides) {
        return Reflect.get(overrides, prop, receiver);
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, prop, value, receiver) {
      if (prop in overrides) {
        return Reflect.set(overrides, prop, value, receiver);
      }
      return Reflect.set(target, prop, value, target);
    },
  }) as T;
}

function createFailOnceRecordAgentResponseStore(inner: LocalConsoleStore): LocalConsoleStore {
  let failNextRecord = true;
  return wrapStore(inner, {
    async recordAgentResponse(input: Parameters<LocalConsoleStore["recordAgentResponse"]>[0]) {
      if (failNextRecord) {
        failNextRecord = false;
        throw new Error("injected-record-agent-response-before-commit");
      }
      await inner.recordAgentResponse(input);
    },
  } as Partial<LocalConsoleStore>);
}

await main();
