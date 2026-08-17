import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLocalExecutionRunner } from "../../src/local-console/execution-driver.js";
import {
  foldRunActivityStep,
  projectStructuredRunActivity,
  type LocalRunActivity,
} from "../../src/local-console/run-activity.js";
import { planTerminalProcessSteps } from "../../src/local-console/terminal-record-plan.js";
import type { LocalConsoleExecutionProfile } from "../../src/local-console/types.js";
import { runClaude } from "../../src/claude.js";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

/**
 * process-step-detail 真机验收（PRD 验收 44–50 的引擎侧与历史数据侧）：
 * - 真实 Claude / Codex / Kimi CLI 各跑一次 full run，断言结构化活动投影后
 *   出现可读思考首句步骤（验收 46），且真实 Claude argv 携带
 *   --thinking-display summarized（本机 2.1.222 满足独立能力门槛）；
 * - 时间线对象与输入不出现本机密钥/凭据模式（秘密边界实证）；
 * - 用真实历史会话 local:2026-08-16T06:35:09.059Z-h0m3op（升级前落库）
 *   确认旧步骤无 input/output 字段、映射后保持缺失（展开显示未记录、
 *   不回填）。
 * 临时数据与 evidence 均写系统临时目录。
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const evidenceDir = await createAcceptanceOutputDirectory("process-step-detail");
const evidencePath = path.join(evidenceDir, "evidence.json");
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-process-step-detail-"));
const workspace = path.join(runtimeRoot, "workspace");
await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(path.join(workspace, "hello.txt"), "process-step-detail acceptance\n", "utf8");

const evidence: Record<string, unknown> = {
  runtimeRoot,
  workspace,
  environment: { platform: process.platform, node: process.version },
  providers: {},
  history: null,
};

const PROMPT = [
  "先简短思考如何完成这个任务，再读取当前目录下的 hello.txt，",
  "最后只回复两个字：完成",
].join("");

const capturedClaudeArgs: string[] = [];
const runner = createLocalExecutionRunner({
  dataRoot: runtimeRoot,
  runClaude: (options) => runClaude({
    ...options,
    spawnProcess: (executable, args, spawnOptions) => {
      capturedClaudeArgs.push(...args);
      return spawn(executable, args, {
        cwd: spawnOptions.cwd,
        env: spawnOptions.env,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
    },
  }),
});

const providers: Array<{ engine: "codex" | "claude" | "kimi"; profile: LocalConsoleExecutionProfile | null }> = [
  { engine: "codex", profile: null },
  { engine: "claude", profile: { cli: "claude", model: "sonnet", effort: "high" } },
  { engine: "kimi", profile: { cli: "kimi", model: "kimi-code/kimi-for-coding", effort: "on" } },
];

function projectTrail(events: readonly unknown[]): readonly LocalRunActivity[] {
  let steps: readonly LocalRunActivity[] = [];
  let cursor = 0;
  const now = () => new Date().toISOString();
  for (const event of events) {
    const activity = projectStructuredRunActivity(event, ++cursor, now());
    if (activity !== null) steps = foldRunActivityStep(steps, activity);
  }
  return steps;
}

for (const provider of providers) {
  // 模型是否产生 reasoning 有真实波动（短任务可能不思考）；能力验收允许
  // 有限重试，全部失败才算未满足。每次尝试都如实记录。
  const attempts: unknown[] = [];
  let attempt = 0;
  let result: Awaited<ReturnType<typeof runner>> | null = null;
  let events: unknown[] = [];
  while (attempt < 3) {
    attempt += 1;
    process.stderr.write(`[process-step-detail] ${provider.engine}: full run (attempt ${String(attempt)})\n`);
    events = [];
    const startedAt = Date.now();
    const current = await runner({
      prompt: PROMPT,
      runDir: path.join(runtimeRoot, `run-${provider.engine}-${String(attempt)}`),
      cwd: workspace,
      profile: provider.profile,
      mode: { kind: "full" },
      onStructuredActivity: (event) => {
        events.push(event);
      },
      idleTimeoutMs: 90_000,
      toolTimeoutMs: 90_000,
      maxDurationMs: 240_000,
    });
    const durationMs = Date.now() - startedAt;
    result = current;
    const steps = projectTrail(events);
    const thinkingSteps = steps.filter((step) => step.kind === "thinking");
    const readableThinking = thinkingSteps.filter((step) => step.object !== null && step.object !== undefined);
    const serializedTrail = JSON.stringify(steps);
    const credentialLeak = /(?:sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|(?:token|password|api[_-]?key)\s*[:=]\s*[^\s*])/iu.exec(serializedTrail);
    const eventTypes = [...new Set(events.flatMap((event) => {
      const record = typeof event === "object" && event !== null ? event as Record<string, unknown> : {};
      const item = typeof record.item === "object" && record.item !== null ? record.item as Record<string, unknown> : {};
      return [typeof item.type === "string" ? item.type : String(record.type ?? "?")];
    }))];
    const record: Record<string, unknown> = {
      attempt,
      ok: current.ok,
      reason: current.ok ? null : current.reason,
      durationMs,
      eventCount: events.length,
      stepCount: steps.length,
      thinkingStepCount: thinkingSteps.length,
      readableThinkingStepCount: readableThinking.length,
      thinkingSamples: readableThinking.slice(0, 3).map((step) => step.object),
      toolStepCount: steps.filter((step) => step.kind === "tool").length,
      credentialLeak: credentialLeak?.[0] ?? null,
      eventTypes,
    };
    attempts.push(record);
    process.stdout.write(`${JSON.stringify({ engine: provider.engine, ...record })}\n`);

    if (credentialLeak !== null) {
      throw new Error(`${provider.engine} trail leaked credential pattern: ${credentialLeak[0]}`);
    }
    if (readableThinking.length > 0) {
      break;
    }
  }
  (evidence.providers as Record<string, unknown>)[provider.engine] = attempts;
  const best = attempts.at(-1) as Record<string, unknown> | undefined;
  if (best === undefined) throw new Error(`${provider.engine} produced no attempt`);
  if (provider.engine === "codex" && best.ok !== true) {
    throw new Error(`codex provider turn did not complete: ${String(best.reason)}`);
  }
  if (provider.engine === "claude" && best.ok !== true) {
    throw new Error(`claude provider turn did not complete: ${String(best.reason)}`);
  }
  if (provider.engine === "kimi" && best.ok !== true) {
    // Kimi 额度状态可能不可用；如实记录并继续（kimi-empty-response 先例）。
    process.stderr.write(`[process-step-detail] kimi turn failed: ${String(best.reason)}\n`);
  }
  if (Number(best.readableThinkingStepCount ?? 0) === 0) {
    throw new Error(`${provider.engine} produced no readable thinking step in 3 attempts (验收 46 未满足)`);
  }
}

const claudeThinkingDisplay = capturedClaudeArgs.includes("--thinking-display")
  && capturedClaudeArgs[capturedClaudeArgs.indexOf("--thinking-display") + 1] === "summarized";
evidence.claudeArgv = {
  thinkingDisplayFlag: claudeThinkingDisplay,
  argCount: capturedClaudeArgs.length,
};
if (!claudeThinkingDisplay) {
  throw new Error("real Claude argv did not carry --thinking-display summarized");
}

// —— 历史会话：升级前落库的旧步骤必须保持缺失（不空白、不回填） ——
const HISTORY_FILE = path.join(
  os.homedir(),
  ".moebius",
  "sessions",
  "bG9jYWw6MjAyNi0wOC0xNlQwNjozNTowOS4wNTlaLWgwbTNvcA.jsonl",
);
const history = await readHistorySessions(HISTORY_FILE);
evidence.history = history;
if (history.oldStepCount === 0) {
  throw new Error(`history session ${HISTORY_FILE} carried no old process steps`);
}
if (!history.allOldStepsKeepMissingFields) {
  throw new Error("an old history step gained fabricated input/output fields");
}

await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
process.stdout.write(`${JSON.stringify({ ok: true, evidencePath, evidence })}\n`);

interface HistoryStepSummary {
  kind: string;
  object: string | null;
  hasInput: boolean;
  hasOutput: boolean;
  hasError: boolean;
  hasRemaining: boolean;
  mappedInput: boolean;
  mappedOutput: boolean;
}

async function readHistorySessions(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, "utf8");
  const wireSteps: Array<Record<string, unknown>> = [];
  for (const line of raw.split(/\r?\n/u)) {
    if (line.trim() === "") continue;
    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (typeof event !== "object" || event === null) continue;
    const record = event as Record<string, unknown>;
    if (!Array.isArray(record.messageUpserts)) continue;
    for (const message of record.messageUpserts) {
      if (typeof message !== "object" || message === null) continue;
      const wire = message as Record<string, unknown>;
      if (!Array.isArray(wire.processSteps)) continue;
      for (const step of wire.processSteps) {
        if (typeof step === "object" && step !== null) {
          wireSteps.push(step as Record<string, unknown>);
        }
      }
    }
  }
  const mapped = planTerminalProcessSteps(wireSteps as unknown as readonly LocalRunActivity[]);
  const steps: HistoryStepSummary[] = wireSteps.map((s, index) => ({
    kind: typeof s.kind === "string" ? s.kind : "unknown",
    object: typeof s.object === "string" ? s.object : null,
    hasInput: "input" in s,
    hasOutput: "output" in s,
    hasError: "error" in s,
    hasRemaining: "outputRemainingLines" in s,
    mappedInput: mapped[index]?.input !== undefined,
    mappedOutput: mapped[index]?.output !== undefined,
  }));
  return {
    sessionId: "local:2026-08-16T06:35:09.059Z-h0m3op",
    file: filePath,
    oldStepCount: steps.length,
    allOldStepsKeepMissingFields: steps.every((step) =>
      !step.hasInput && !step.hasOutput && !step.hasError && !step.hasRemaining
      && !step.mappedInput && !step.mappedOutput),
    kinds: [...new Set(steps.map((step) => step.kind))],
  };
}
