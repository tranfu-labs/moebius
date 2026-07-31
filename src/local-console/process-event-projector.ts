export interface LocalConsoleProcessEventBase {
  key: string;
  engine: "codex" | "claude" | "kimi";
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
      kind: "thinking";
      thinking: string;
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
    engine: "codex",
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

function readProviderTimestamp(value: unknown): string | null {
  if (typeof value === "string" && value !== "") {
    return value;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
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

export function projectClaudeTranscriptRecord(
  value: unknown,
  context: ProjectCodexRolloutContext,
): LocalConsoleProcessEvent[] {
  const keyPrefix = `${context.runId}:claude:${String(context.lineOffset)}`;
  if (!isRecord(value)) {
    return [providerUnsupported("claude", keyPrefix, null, "unknown", value)];
  }
  const timestamp = readString(value.timestamp);
  const recordType = readString(value.type) ?? "unknown";
  const message = isRecord(value.message) ? value.message : null;
  const role = message === null ? null : readString(message.role);
  const content = message?.content;
  if (recordType === "assistant" && role === "assistant" && Array.isArray(content)) {
    const events = content.flatMap((part, index): LocalConsoleProcessEvent[] => {
      if (!isRecord(part)) {
        return [providerUnsupported(
          "claude",
          `${keyPrefix}:${String(index)}`,
          timestamp,
          "assistant · unknown",
          part,
        )];
      }
      const type = readString(part.type) ?? "unknown";
      const base = providerBase(
        "claude",
        `${keyPrefix}:${String(index)}`,
        timestamp,
        `assistant · ${type}`,
        part,
      );
      if (type === "text") {
        const output = readText(part.text);
        return output === null ? [] : [{ ...base, kind: "agent-output", output }];
      }
      if (type === "thinking") {
        return [{
          ...base,
          kind: "thinking",
          thinking: readString(part.thinking) ?? "",
        }];
      }
      if (type === "tool_use") {
        return [{
          ...base,
          kind: "tool",
          phase: "started",
          name: readString(part.name) ?? "tool_use",
          callId: readCallId(part),
          status: null,
          input: rawField(part.input),
          output: null,
        }];
      }
      return [{ ...base, kind: "unsupported-debug" }];
    });
    const usage = message !== null && isRecord(message.usage) ? message.usage : null;
    if (usage !== null) {
      events.push({
        ...providerBase("claude", `${keyPrefix}:usage`, timestamp, "assistant · usage", usage),
        kind: "usage",
        usage: serializeRaw(usage),
      });
    }
    return events;
  }
  if (recordType === "user" && role === "user" && Array.isArray(content)) {
    return content.flatMap((part, index): LocalConsoleProcessEvent[] => {
      if (!isRecord(part) || part.type !== "tool_result") {
        return [];
      }
      return [{
        ...providerBase(
          "claude",
          `${keyPrefix}:${String(index)}`,
          timestamp,
          "user · tool_result",
          part,
        ),
        kind: "tool",
        phase: "completed",
        name: readString(part.name) ?? "tool_result",
        callId: readString(part.tool_use_id) ?? readCallId(part),
        status: part.is_error === true ? "error" : "completed",
        input: null,
        output: rawField(part.content),
      }];
    });
  }
  if (recordType === "system" && value.level === "error") {
    return [{
      ...providerBase("claude", keyPrefix, timestamp, "system", value),
      kind: "error",
      message: readText(value.subtype) ?? "Claude system error",
      detail: rawField(value.hookErrors) ?? rawField(value.stopReason),
    }];
  }
  if (
    recordType === "user"
    || recordType === "attachment"
    || recordType === "last-prompt"
    || recordType === "custom-title"
    || recordType === "mode"
  ) {
    return [];
  }
  return [providerUnsupported("claude", keyPrefix, timestamp, recordType, value)];
}

export function projectKimiWireRecord(
  value: unknown,
  context: ProjectCodexRolloutContext,
): LocalConsoleProcessEvent[] {
  const keyPrefix = `${context.runId}:kimi:${String(context.lineOffset)}`;
  if (!isRecord(value)) {
    return [providerUnsupported("kimi", keyPrefix, null, "unknown", value)];
  }
  const timestamp = readProviderTimestamp(value.time) ?? readProviderTimestamp(value.created_at);
  const recordType = readString(value.type) ?? "unknown";
  if (
    recordType === "metadata"
    || recordType === "config.update"
    || recordType === "tools.set_active_tools"
    || recordType === "context.append_message"
    || recordType === "turn.prompt"
  ) {
    return [];
  }
  if (recordType === "context.append_loop_event" && isRecord(value.event)) {
    const event = value.event;
    const eventType = readString(event.type) ?? "unknown";
    const base = providerBase("kimi", keyPrefix, timestamp, `loop · ${eventType}`, event);
    if (eventType === "content.part" && isRecord(event.part)) {
      const partType = readString(event.part.type) ?? "unknown";
      if (partType === "think") {
        const thinking = readText(event.part.think);
        return thinking === null ? [] : [{
          ...base,
          protocolType: `${base.protocolType} · think`,
          kind: "thinking",
          thinking,
        }];
      }
      if (partType === "text") {
        const output = readText(event.part.text);
        return output === null ? [] : [{
          ...base,
          protocolType: `${base.protocolType} · text`,
          kind: "agent-output",
          output,
        }];
      }
    }
    if (eventType === "tool.call") {
      return [{
        ...base,
        kind: "tool",
        phase: "started",
        name: readString(event.name) ?? "tool.call",
        callId: readString(event.toolCallId) ?? readCallId(event),
        status: "started",
        input: rawField(event.args),
        output: null,
      }];
    }
    if (eventType === "tool.result") {
      return [{
        ...base,
        kind: "tool",
        phase: "completed",
        name: "tool.result",
        callId: readString(event.toolCallId) ?? readCallId(event),
        status: "completed",
        input: null,
        output: rawField(event.result),
      }];
    }
    if (eventType === "step.end" && event.usage !== undefined) {
      return [{
        ...base,
        kind: "usage",
        usage: serializeRaw(event.usage),
      }];
    }
    if (eventType === "step.begin") {
      return [];
    }
    return [{ ...base, kind: "unsupported-debug" }];
  }
  if (recordType === "usage.record") {
    return [{
      ...providerBase("kimi", keyPrefix, timestamp, recordType, value),
      kind: "usage",
      usage: serializeRaw(value.usage),
    }];
  }
  if (recordType === "permission.record_approval_result") {
    return [{
      ...providerBase("kimi", keyPrefix, timestamp, recordType, value),
      kind: "tool",
      phase: "completed",
      name: readString(value.toolName) ?? "permission",
      callId: readString(value.toolCallId),
      status: rawField(value.result),
      input: rawField(value.action),
      output: null,
    }];
  }
  if (recordType === "turn.cancel") {
    return [{
      ...providerBase("kimi", keyPrefix, timestamp, recordType, value),
      kind: "error",
      message: "Kimi turn cancelled",
      detail: null,
    }];
  }
  return [providerUnsupported("kimi", keyPrefix, timestamp, recordType, value)];
}

export function malformedProviderProcessEvent(
  engine: "claude" | "kimi",
  runId: string,
  lineOffset: number,
): LocalConsoleProcessEvent {
  return {
    ...providerBase(
      engine,
      `${runId}:${engine}:${String(lineOffset)}:malformed`,
      null,
      "malformed-jsonl",
      "",
    ),
    kind: "error",
    message: "过程记录读取异常",
    detail: `这一条 ${engine === "claude" ? "Claude" : "Kimi"} 过程记录无法解析。`,
  };
}

function providerBase(
  engine: "claude" | "kimi",
  key: string,
  timestamp: string | null,
  protocolType: string,
  payload: unknown,
): LocalConsoleProcessEventBase {
  return {
    key,
    engine,
    timestamp,
    protocolType,
    rawPayload: serializeRaw(redactOpaqueProviderPayload(payload)),
  };
}

function redactOpaqueProviderPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactOpaqueProviderPayload);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/(?:encrypted|signature|opaque)/iu.test(key))
      .map(([key, child]) => [key, redactOpaqueProviderPayload(child)]),
  );
}

function providerUnsupported(
  engine: "claude" | "kimi",
  key: string,
  timestamp: string | null,
  protocolType: string,
  payload: unknown,
): LocalConsoleProcessEvent {
  return {
    ...providerBase(engine, key, timestamp, protocolType, payload),
    kind: "unsupported-debug",
  };
}
