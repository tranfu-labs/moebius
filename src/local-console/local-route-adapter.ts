import type { CodexRunResult } from "../codex.js";
import type { TimelineMessage } from "../conversation.js";
import type { LocalRouteJudgment, LocalRouteJudgmentInput } from "./route-bus.js";
import type { LocalConsoleMessage } from "./types.js";
import { planRuntimeFallback } from "./runtime-domain.js";
import { parseLocalRouteJudgment, validateLocalRouteAppendBody } from "./local-route-judgment.js";
import { loadLocalRoutePersona } from "./local-route-persona.js";

const DEFAULT_LOCAL_ROUTE_TIMEOUT_MS = 300_000;

export const defaultLocalRouteJudgment: LocalRouteJudgment = async (input) => {
  const run = input.runCodex;
  if (run === undefined) {
    return { action: "FAIL_OPEN", reason: "codex-failed", detail: "missing-local-route-runner" };
  }
  let persona: string;
  try {
    persona = await loadLocalRoutePersona(input.agentsDir);
  } catch (error) {
    return { action: "FAIL_OPEN", reason: "persona-load-failed", detail: formatError(error) };
  }
  const controller = new AbortController();
  let result: CodexRunResult;
  try {
    result = await withTimeout(
      run({
        prompt: buildLocalRoutePrompt({
          persona,
          timeline: input.timeline,
          latestMessage: input.latestMessage,
          availableAgentNames: input.availableAgentNames,
        }),
        runDir: `${input.runDir}-local-route`,
        mode: { kind: "full" },
        signal: controller.signal,
      }),
      planRuntimeFallback(input.timeoutMs, DEFAULT_LOCAL_ROUTE_TIMEOUT_MS),
      () => controller.abort(),
    );
  } catch (error) {
    return { action: "FAIL_OPEN", reason: "codex-failed", detail: formatError(error) };
  }
  if (!result.ok) return { action: "FAIL_OPEN", reason: "codex-failed", detail: result.reason };
  if (result.finalText.trim() === "") return { action: "FAIL_OPEN", reason: "empty-output" };
  const parsed = parseLocalRouteJudgment(result.finalText);
  if (parsed.kind === "invalid_json") {
    return { action: "FAIL_OPEN", reason: "invalid-json", detail: parsed.detail };
  }
  if (parsed.kind === "unknown_action") {
    return { action: "FAIL_OPEN", reason: "unknown-action", detail: parsed.detail };
  }
  if (parsed.kind === "no_action") return { action: "NO_ACTION", reason: "ceo-no-action" };
  const validation = validateLocalRouteAppendBody(parsed.body, input.availableAgentNames);
  if (!validation.ok) {
    return { action: "FAIL_OPEN", reason: validation.reason, detail: validation.detail };
  }
  return { action: "APPEND", body: parsed.body, targetRole: validation.targetRole, reason: "appended" };
};

export const validateLocalRouteAppend = validateLocalRouteAppendBody;

function buildLocalRoutePrompt(input: {
  persona: string;
  timeline: TimelineMessage[];
  latestMessage: LocalConsoleMessage;
  availableAgentNames: string[];
}): string {
  const latest = input.timeline[input.timeline.length - 1];
  return `${input.persona.trimEnd()}

请根据以下本地对话操作台 session 上下文，对最新无 mention 本地消息做一次轻量路由判定。
这是 local-console no-trigger 兜底：如果最新消息没有明确下一步控制权移交意图，输出 no_action；如果有明确路由意图，只能输出一条 append 正文，正文必须包含且只包含一个合法 agent mention。不要使用 GitHub issue/comment/reaction 语义。

输出格式只能是以下 JSON 之一：
{"action":"no_action"}
{"action":"append","body":"<一条只含单个合法 agent mention 的追加本地消息>"}

可触发 agent:
${input.availableAgentNames.join(", ")}

localSessionId:
${input.latestMessage.sessionId}

localTimeline:
${formatLocalTimeline(input.timeline)}

latestLocalMessage:
${planRuntimeFallback(latest?.body, input.latestMessage.body).trimEnd()}`;
}

function formatLocalTimeline(timeline: TimelineMessage[]): string {
  if (timeline.length === 0) return "(none)";
  return timeline
    .map((message) => `${String(message.index)} ${message.speaker}:\n${message.body.trimEnd()}`)
    .join("\n\n");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timeout = setTimeout(() => {
        onTimeout();
        reject(new Error(`local-route-timeout:${String(timeoutMs)}ms`));
      }, timeoutMs);
      promise.then(resolve, reject);
    });
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
