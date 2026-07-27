export interface LocalConsoleProcessEventBase {
  key: string;
  timestamp: string | null;
  protocolType: string;
  rawPayload: string;
}

export type LocalConsoleProcessEvent =
  | (LocalConsoleProcessEventBase & {
      kind: "agent-output";
      output: string;
    })
  | (LocalConsoleProcessEventBase & {
      kind: "command";
      phase: "started" | "completed";
      name: string;
      callId: string | null;
      status: string | null;
      input: string | null;
      output: string | null;
      exitCode: number | null;
    })
  | (LocalConsoleProcessEventBase & {
      kind: "tool";
      phase: "started" | "completed";
      name: string;
      callId: string | null;
      status: string | null;
      input: string | null;
      output: string | null;
    })
  | (LocalConsoleProcessEventBase & {
      kind: "file";
      action: string;
      path: string | null;
      detail: string | null;
    })
  | (LocalConsoleProcessEventBase & {
      kind: "error";
      message: string;
      detail: string | null;
    })
  | (LocalConsoleProcessEventBase & {
      kind: "usage";
      usage: string;
    })
  | (LocalConsoleProcessEventBase & {
      kind: "unsupported-debug";
    });

export interface ProjectCodexRolloutContext {
  runId: string;
  lineOffset: number;
}

const INVOCATION_TOP_LEVEL_TYPES = new Set(["session_meta", "turn_context"]);
const REASONING_PAYLOAD_TYPES = new Set(["reasoning", "agent_reasoning"]);
const PROMPT_ROLES = new Set(["developer", "system", "user"]);

export function projectCodexRolloutRecord(
  value: unknown,
  context: ProjectCodexRolloutContext,
): LocalConsoleProcessEvent[] {
  const keyPrefix = `${context.runId}:rollout:${String(context.lineOffset)}`;
  if (!isRecord(value)) {
    return [unsupportedDebug(keyPrefix, null, "unknown", value)];
  }

  const timestamp = typeof value.timestamp === "string" ? value.timestamp : null;
  const topLevelType = typeof value.type === "string" ? value.type : "unknown";
  const payload = isRecord(value.payload) ? value.payload : null;
  const payloadType = payload !== null && typeof payload.type === "string"
    ? payload.type
    : null;
  const protocolType = payloadType === null
    ? topLevelType
    : `${topLevelType} · ${payloadType}`;

  if (INVOCATION_TOP_LEVEL_TYPES.has(topLevelType)) {
    return [];
  }
  if (
    payloadType !== null
    && (
      REASONING_PAYLOAD_TYPES.has(payloadType)
      || (payloadType === "message" && PROMPT_ROLES.has(readString(payload?.role) ?? ""))
      || payloadType === "user_message"
    )
  ) {
    return [];
  }
  if (containsEncryptedReasoning(value)) {
    return [];
  }
  if (payload === null) {
    return [unsupportedDebug(keyPrefix, timestamp, protocolType, value)];
  }

  if (payloadType === "token_count" || payloadType === "usage") {
    const usage = payload.info ?? payload.usage ?? payload;
    return [{
      ...baseEvent(keyPrefix, timestamp, protocolType, payload),
      kind: "usage",
      usage: serializeRaw(usage),
    }];
  }

  if (topLevelType === "event_msg") {
    return projectEventMessage(payload, keyPrefix, timestamp, protocolType);
  }
  if (topLevelType === "response_item") {
    return projectResponseItem(payload, keyPrefix, timestamp, protocolType);
  }
  return [unsupportedDebug(keyPrefix, timestamp, protocolType, payload)];
}

export function malformedCodexRolloutEvent(
  runId: string,
  lineOffset: number,
  detail = "这一条 Codex 过程记录无法解析。",
): LocalConsoleProcessEvent {
  return {
    ...baseEvent(
      `${runId}:rollout:${String(lineOffset)}:malformed`,
      null,
      "malformed-jsonl",
      detail,
    ),
    kind: "error",
    message: "过程记录读取异常",
    detail,
  };
}

function projectEventMessage(
  payload: Record<string, unknown>,
  keyPrefix: string,
  timestamp: string | null,
  protocolType: string,
): LocalConsoleProcessEvent[] {
  const type = readString(payload.type) ?? "unknown";
  const base = baseEvent(keyPrefix, timestamp, protocolType, payload);
  if (type === "agent_message") {
    const output = readText(payload.message);
    return output === null ? [] : [{ ...base, kind: "agent-output", output }];
  }
  if (type === "mcp_tool_call_end") {
    const invocation = isRecord(payload.invocation) ? payload.invocation : {};
    const server = readString(invocation.server) ?? "MCP";
    const tool = readString(invocation.tool) ?? "tool";
    return [{
      ...base,
      kind: "tool",
      phase: "completed",
      name: `${server} · ${tool}`,
      callId: readCallId(payload) ?? readCallId(invocation),
      status: readStatus(payload.result) ?? readString(payload.status),
      input: rawField(invocation.arguments),
      output: rawField(payload.result),
    }];
  }
  if (type === "patch_apply_end") {
    const changes = isRecord(payload.changes) ? Object.entries(payload.changes) : [];
    if (changes.length > 0) {
      return changes.map(([filePath, change], index) => ({
        ...baseEvent(`${keyPrefix}:patch:${String(index)}`, timestamp, protocolType, payload),
        kind: "file",
        action: fileAction(change),
        path: filePath,
        detail: rawField(change),
      }));
    }
    if (payload.success === false) {
      return [{
        ...base,
        kind: "error",
        message: "文件修改失败",
        detail: rawField(payload.stderr) ?? rawField(payload.stdout),
      }];
    }
    return [{
      ...base,
      kind: "file",
      action: "应用文件修改",
      path: null,
      detail: rawField(payload.stdout),
    }];
  }
  if (type === "web_search_end") {
    return [{
      ...base,
      kind: "tool",
      phase: "completed",
      name: "web_search",
      callId: readCallId(payload),
      status: readString(payload.status) ?? "completed",
      input: rawField(payload.query),
      output: rawField(payload.results),
    }];
  }
  if (type === "turn_aborted" || type === "thread_rolled_back") {
    return [{
      ...base,
      kind: "error",
      message: type,
      detail: rawField(payload.reason) ?? rawField(payload.num_turns),
    }];
  }
  if (type.includes("error") || type === "stream_failure") {
    return [{
      ...base,
      kind: "error",
      message: readText(payload.message) ?? readText(payload.error) ?? type,
      detail: rawField(payload.details),
    }];
  }
  return [unsupportedDebug(`${keyPrefix}:event`, timestamp, protocolType, payload)];
}

function projectResponseItem(
  payload: Record<string, unknown>,
  keyPrefix: string,
  timestamp: string | null,
  protocolType: string,
): LocalConsoleProcessEvent[] {
  const type = readString(payload.type) ?? "unknown";
  const base = baseEvent(keyPrefix, timestamp, protocolType, payload);
  if (type === "message" || type === "agent_message") {
    if (type === "message" && payload.role !== "assistant") {
      return [];
    }
    const output = readContentText(payload.content);
    return output === null ? [] : [{ ...base, kind: "agent-output", output }];
  }
  if (type === "function_call") {
    return [{
      ...base,
      kind: isCommandName(readString(payload.name)) ? "command" : "tool",
      phase: "started",
      name: readString(payload.name) ?? "function_call",
      callId: readCallId(payload),
      status: readString(payload.status),
      input: rawField(payload.arguments),
      output: null,
      ...(isCommandName(readString(payload.name)) ? { exitCode: null } : {}),
    } as LocalConsoleProcessEvent];
  }
  if (type === "function_call_output") {
    return [{
      ...base,
      kind: "tool",
      phase: "completed",
      name: readString(payload.name) ?? "function_call_output",
      callId: readCallId(payload),
      status: readString(payload.status),
      input: null,
      output: rawField(payload.output),
    }];
  }
  if (type === "custom_tool_call" || type === "tool_search_call") {
    const name = readString(payload.name) ?? type;
    const command = isCommandName(name);
    return [{
      ...base,
      kind: command ? "command" : "tool",
      phase: "started",
      name,
      callId: readCallId(payload),
      status: readString(payload.status),
      input: rawField(payload.input) ?? rawField(payload.arguments),
      output: null,
      ...(command ? { exitCode: null } : {}),
    } as LocalConsoleProcessEvent];
  }
  if (type === "custom_tool_call_output" || type === "tool_search_output") {
    return [{
      ...base,
      kind: "tool",
      phase: "completed",
      name: readString(payload.name) ?? type,
      callId: readCallId(payload),
      status: readString(payload.status),
      input: null,
      output: rawField(payload.output) ?? rawField(payload.tools),
    }];
  }
  if (type === "command_execution") {
    return [{
      ...base,
      kind: "command",
      phase: payload.status === "completed" ? "completed" : "started",
      name: "command_execution",
      callId: readCallId(payload),
      status: readString(payload.status),
      input: rawField(payload.command) ?? rawField(payload.text),
      output: rawField(payload.output),
      exitCode: typeof payload.exit_code === "number" ? payload.exit_code : null,
    }];
  }
  return [unsupportedDebug(`${keyPrefix}:response`, timestamp, protocolType, payload)];
}

function baseEvent(
  key: string,
  timestamp: string | null,
  protocolType: string,
  payload: unknown,
): LocalConsoleProcessEventBase {
  return {
    key,
    timestamp,
    protocolType,
    rawPayload: serializeRaw(payload),
  };
}

function unsupportedDebug(
  key: string,
  timestamp: string | null,
  protocolType: string,
  payload: unknown,
): LocalConsoleProcessEvent {
  return {
    ...baseEvent(key, timestamp, protocolType, payload),
    kind: "unsupported-debug",
  };
}

function readContentText(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return readText(value);
  }
  const parts = value.flatMap((part): string[] => {
    if (!isRecord(part)) {
      return [];
    }
    const type = readString(part.type) ?? "";
    if (type !== "output_text" && type !== "input_text" && type !== "text") {
      return [];
    }
    const text = readText(part.text);
    return text === null ? [] : [text];
  });
  return parts.length === 0 ? null : parts.join("");
}

function rawField(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === "string" ? value : serializeRaw(value);
}

function serializeRaw(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function containsEncryptedReasoning(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsEncryptedReasoning);
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.entries(value).some(([key, child]) =>
    key === "encrypted_content" || containsEncryptedReasoning(child));
}

function readCallId(value: Record<string, unknown>): string | null {
  return readString(value.call_id) ?? readString(value.callId) ?? readString(value.id);
}

function readStatus(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  return readString(value.status);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function isCommandName(value: string | null): boolean {
  return value === "exec_command" || value === "shell" || value === "command";
}

function fileAction(value: unknown): string {
  if (!isRecord(value)) {
    return "文件变更";
  }
  const type = readString(value.type) ?? readString(value.kind);
  if (type === "add" || type === "create") {
    return "新增文件";
  }
  if (type === "delete" || type === "remove") {
    return "删除文件";
  }
  return type === null ? "修改文件" : type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
