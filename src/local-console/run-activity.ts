import path from "node:path";

export type LocalRunActivityKind =
  | "command"
  | "tool"
  | "search"
  | "read"
  | "edit"
  | "thinking"
  | "progress";

export interface LocalRunActivity {
  cursor: number;
  kind: LocalRunActivityKind;
  phase: "running" | "completed";
  action: string;
  object: string | null;
  occurredAt: string;
  /**
   * 常驻活动行的安全对象：命令只保留清洗后的前两个 token，绝不带参数、路径
   * 或输出（PRD 验收 4 约束这条行）。步骤行使用 `object`，两者只在命令类型上
   * 分叉；其余类型没有本字段，活动行回退到 `object`。
   */
  lineObject?: string | null;
  /** Provider 调用标识：同一工具调用的开始与返回共享该值；旧记录没有。 */
  callId?: string | null;
  /** 展开态可见的只读输入。`undefined` 表示旧记录未存储该字段。 */
  input?: string | null;
  /** 投影时已按上限裁剪的纯文本输出。`undefined` 表示旧记录未存储该字段。 */
  output?: string | null;
  outputRemainingLines?: number;
  /** 清洗后的失败说明首句；纯退出码行由视图跳过。 */
  error?: string | null;
}

/**
 * Providers wrap the interesting item in an envelope, and each one nests it
 * differently: Codex puts it in `item`/`payload`, Claude streams it as
 * `stream_event.event.content_block` and repeats it in `message.content[]`,
 * Kimi pushes it as `session/update` params with an `update` payload. Reading
 * only the outer `type` sees "stream_event" and loses both the tool name and
 * the thinking block, which is why the trail used to be a wall of identical
 * "using a tool" lines.
 */
function unwrapActivityItem(value: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(value.item)) return value.item;
  if (isRecord(value.payload)) return value.payload;
  if (isRecord(value.content_block)) return value.content_block;
  if (isRecord(value.event)) return unwrapActivityItem(value.event);
  if (isRecord(value.message) && Array.isArray(value.message.content)) {
    const block = [...value.message.content]
      .reverse()
      .find((candidate) => isRecord(candidate) && isActivityBlock(readString(candidate.type)));
    if (isRecord(block)) return block;
  }
  if (isRecord(value.update)) return value.update;
  return value;
}

function isActivityBlock(type: string | null): boolean {
  return type === "thinking" || isToolType(type) || isCommandType(type) || isFileType(type);
}

export function projectStructuredRunActivity(
  value: unknown,
  cursor: number,
  occurredAt: string,
): LocalRunActivity | null {
  if (!isRecord(value)) return null;
  const eventType = readString(value.type);
  const item = unwrapActivityItem(value);
  const itemType = readString(item.type)
    ?? readString(item.sessionUpdate)
    ?? readString(item.session_update)
    ?? eventType;
  if (itemType === null) return null;
  const phase = isToolReturnType(itemType)
    ? "completed"
    : eventType?.includes("completed") === true
      || eventType?.includes("_end") === true
      || readString(item.status) === "completed"
      || readString(item.status) === "failed"
      || readString(item.status) === "error"
      ? "completed"
      : "running";

  if (isThinkingType(itemType, item)) {
    const text = readThinkingText(item);
    const object = thinkingObject(text);
    // 没有可读思考文本就不产出裸的「正在思考」行（PRD 45 不允许只有动作没有
    // 对象的步骤；引擎侧拿不到文本属于引擎能力问题，见 process-step-detail 的
    // 引擎能力模块）。
    if (object === null) return null;
    return activity(cursor, "thinking", phase, object, occurredAt, {
      input: boundStepInput(text),
    });
  }
  if (isToolReturnType(itemType)) {
    return projectToolReturn(cursor, itemType, item, occurredAt);
  }
  if (isCommandType(itemType)) {
    const command = readString(item.command) ?? readString(item.text) ?? readString(item.input);
    const description = readString(item.description);
    return attachReturnState(
      projectCommand(cursor, phase, command, description, readCallId(item), occurredAt),
      itemType,
      item,
    );
  }
  if (isSearchType(itemType)) {
    const query = readString(item.query) ?? readString(item.input);
    return activity(cursor, "search", phase, safeQuotedObject(query), occurredAt, {
      callId: readCallId(item),
      input: boundStepInput(query),
    });
  }
  if (isFileType(itemType)) {
    const filePath = readFilePath(item);
    const edit = itemType?.includes("change") === true
      || itemType?.includes("patch") === true
      || itemType?.includes("write") === true
      || itemType?.includes("edit") === true;
    return activity(cursor, edit ? "edit" : "read", phase, safeFileObject(filePath), occurredAt, {
      callId: readCallId(item),
      input: boundStepInput(filePath),
    });
  }
  if (isToolType(itemType)) {
    const name = stripMcpPrefix(readToolName(item));
    const toolInput = readToolInput(item);
    if (isCommandToolName(name)) {
      const command = readToolCommand(item) ?? (isRecord(toolInput) ? null : toolInput);
      const description = isRecord(toolInput) ? readString(toolInput.description) : null;
      return attachReturnState(
        projectCommand(cursor, phase, command, description, readCallId(item), occurredAt),
        itemType,
        item,
      );
    }
    if (isSkillToolName(name)) {
      const skillName = readSkillName(toolInput);
      return activity(cursor, "tool", phase, scrubLabel(skillName), occurredAt, {
        callId: readCallId(item),
        input: boundStepInput(skillName),
      });
    }
    if (isFileToolName(name)) {
      const filePath = isRecord(toolInput)
        ? readFilePath(toolInput)
        : null;
      const edit = name === "Edit" || name === "Write" || name === "MultiEdit" || name === "NotebookEdit";
      return activity(cursor, edit ? "edit" : "read", phase, safeFileObject(filePath), occurredAt, {
        callId: readCallId(item),
        input: boundStepInput(filePath),
      });
    }
    if (isSearchToolName(name)) {
      const query = isRecord(toolInput)
        ? readString(toolInput.query)
        : null;
      return activity(cursor, "search", phase, safeQuotedObject(query), occurredAt, {
        callId: readCallId(item),
        input: boundStepInput(query),
      });
    }
    return activity(cursor, "tool", phase, scrubLabel(name), occurredAt, {
      callId: readCallId(item),
      input: boundStepInput(typeof toolInput === "string" ? toolInput : null),
    });
  }
  return null;
}

/**
 * 命令步骤：对象优先取引擎自带的用途说明，缺失时取去掉 shell 包装后的命令
 * 原文（不再按空白取前两个 token）；常驻活动行则始终使用安全 token 对象，
 * 保证 PRD 验收 4（活动行不泄露参数、路径）。
 */
function projectCommand(
  cursor: number,
  phase: "running" | "completed",
  command: string | null,
  description: string | null,
  callId: string | null,
  occurredAt: string,
): LocalRunActivity {
  const object = commandObject(command, description);
  const lineObject = description ?? safeCommandObject(command);
  return activity(cursor, "command", phase, object, occurredAt, {
    lineObject,
    callId,
    input: boundStepInput(command),
  });
}

/**
 * 命令完成事件（Codex command_execution）把命令、输出与退出码放在同一条里；
 * 只要事件本身携带输出或失败信号，就把它附着到步骤上，供展开与失败态使用。
 */
function attachReturnState(
  base: LocalRunActivity,
  itemType: string,
  item: Record<string, unknown>,
): LocalRunActivity {
  if (base.phase !== "completed") return base;
  const output = boundStepOutput(scrubSecrets(readToolReturnOutput(item)));
  const failed = readToolReturnFailed(itemType, item);
  const error = failed ? firstContentfulErrorLine(readToolReturnError(itemType, item)) : null;
  if (output === null && error === null) return base;
  return {
    ...base,
    ...(output === null ? {} : { output: output.text, outputRemainingLines: output.remaining }),
    ...(error === null ? {} : { error }),
  };
}

/** 工具返回事件：只作为对应调用步骤的输出与终态，不产出行。 */
function projectToolReturn(
  cursor: number,
  itemType: string,
  item: Record<string, unknown>,
  occurredAt: string,
): LocalRunActivity | null {
  const callId = readCallId(item);
  const failed = readToolReturnFailed(itemType, item);
  const output = boundStepOutput(scrubSecrets(readToolReturnOutput(item)));
  const error = failed ? firstContentfulErrorLine(readToolReturnError(itemType, item)) : null;
  if (callId === null && output === null && error === null) {
    return null;
  }
  return activity(cursor, "tool", "completed", null, occurredAt, {
    callId,
    ...(output === null ? {} : { output: output.text, outputRemainingLines: output.remaining }),
    ...(error === null ? {} : { error }),
  });
}

export function projectAgentProgressActivity(
  markdown: string,
  cursor: number,
  occurredAt: string,
): LocalRunActivity | null {
  const firstLine = markdown
    .split(/\r?\n/u)
    .map((line) => line.replace(/^#{1,6}\s+/u, "").trim())
    .find(Boolean);
  if (firstLine === undefined) return null;
  return {
    cursor,
    kind: "progress",
    phase: "running",
    action: "正在处理",
    object: safeLabel(firstLine),
    occurredAt,
  };
}

export function chooseLatestRunActivity(
  current: LocalRunActivity | null,
  candidate: LocalRunActivity,
): LocalRunActivity {
  if (current === null || candidate.cursor > current.cursor) return candidate;
  if (candidate.cursor < current.cursor) return current;
  return activityPriority(candidate.kind) >= activityPriority(current.kind) ? candidate : current;
}

function activity(
  cursor: number,
  kind: Exclude<LocalRunActivityKind, "progress">,
  phase: "running" | "completed",
  object: string | null,
  occurredAt: string,
  extras: Partial<Pick<LocalRunActivity, "lineObject" | "callId" | "input" | "output" | "outputRemainingLines" | "error">> = {},
): LocalRunActivity {
  const verb = phase === "completed" ? "已完成" : "正在";
  const noun = kind === "thinking"
    ? "思考"
    : kind === "command"
      ? "运行命令"
    : kind === "search"
      ? "搜索"
      : kind === "read"
        ? "读取文件"
        : kind === "edit"
          ? "修改文件"
          : "使用工具";
  return { cursor, kind, phase, action: `${verb}${noun}`, object, occurredAt, ...extras };
}

/**
 * 步骤对象：命令取用途说明或去掉 shell 包装后的命令原文。对象本身可以被
 * 展开详情里的完整输入取代，因此这里只做截断与秘密剥离，不做 token 过滤。
 */
function commandObject(value: string | null, description: string | null): string | null {
  if (description !== null) {
    return scrubLabel(description);
  }
  if (value === null) return null;
  return scrubLabel(stripShellWrapper(value));
}

/**
 * 活动行的安全命令对象：先去 shell 包装，再按空白取前两个非标志、非敏感
 * token，路径压缩为 basename —— PRD 验收 4 只约束这条常驻行。
 */
function safeCommandObject(value: string | null): string | null {
  if (value === null) return null;
  const normalized = stripShellWrapper(value).replace(/[\r\n]+/gu, " ").trim();
  if (normalized === "") return null;
  const segment = normalized.split(/(?:&&|\|\||;|\|)/u).find((entry) => entry.trim() !== "")?.trim() ?? normalized;
  const tokens = segment.match(/"[^"]*"|'[^']*'|\S+/gu) ?? [];
  const safe: string[] = [];
  for (const raw of tokens) {
    const token = raw.replace(/^['"]|['"]$/gu, "");
    if (token.startsWith("-") || token.includes("=") || looksSensitive(token)) continue;
    safe.push(safePathToken(token));
    if (safe.length === 2) break;
  }
  return safe.length === 0 ? null : safe.join(" ");
}

/** 去掉 `zsh -lc` 一类的 shell 包装前缀，让真实命令成为对象的一部分。 */
function stripShellWrapper(value: string): string {
  const stripped = value
    .replace(/^(?:env\s+)?(?:[A-Za-z0-9_./-]*\/)?(?:zsh|bash|sh|fish|dash|ksh|pwsh)(?:\s+-[a-zA-Z]{1,3}\s*)+/iu, "")
    .replace(/^['"]|['"]$/gu, "")
    .trim();
  return stripped === "" ? value : stripped;
}

function safeQuotedObject(value: string | null): string | null {
  const label = scrubLabel(value);
  return label === null ? null : `“${label}”`;
}

function safeFileObject(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  return scrubLabel(path.basename(value.replaceAll("\\", "/")));
}

function safePathToken(value: string): string {
  return value.includes("/") || value.includes("\\")
    ? path.basename(value.replaceAll("\\", "/"))
    : value;
}

/**
 * 对象标签清洗：秘密剥离与 id 移除对全部类型生效；路径压缩不再全局生效，
 * 只由文件对象（basename）与活动行 token 自己处理 —— 搜索查询与 URL 因此
 * 不会被拆成末段。
 */
function scrubLabel(value: string | null): string | null {
  if (value === null) return null;
  const withoutIds = value
    .replace(/\b(?:run|session|thread|call)[_-]?id\s*[:=]\s*\S+/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const scrubbed = scrubSecrets(withoutIds);
  return scrubbed === "" ? null : scrubbed.slice(0, 96);
}

/** 保留给进度 Markdown 的旧路径压缩行为（对象可能来自正文首行）。 */
function safeLabel(value: string | null): string | null {
  if (value === null) return null;
  const withoutIds = value
    .replace(/\b(?:run|session|thread|call)[_-]?id\s*[:=]\s*\S+/giu, "")
    .replace(/(?:\/[^\s"'`]+)+/gu, (match) => path.basename(match))
    .replace(/\s+/gu, " ")
    .trim();
  return withoutIds === "" ? null : withoutIds.slice(0, 96);
}

/** 秘密剥离全局生效：任何类型的对象、输入与输出都不得带凭据赋值。 */
function scrubSecrets(value: string | null): string {
  if (value === null) return "";
  return value
    .replace(
      /\b(?:token|secret|password|api[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      (match) => {
        const separator = /[:=]/u.exec(match)?.[0] ?? "=";
        return `${match.slice(0, match.indexOf(separator) + 1)}***`;
      },
    )
    // Authorization: Bearer <token> 的凭据在 Bearer 之后，不是 Bearer 本身。
    .replace(
      /\b(?:authorization|bearer)(?:\s*[:=]\s*|\s+)bearer\s+(?:"[^"]*"|'[^']*'|\S+)/giu,
      "authorization: ***",
    )
    .replace(
      /\b(?:authorization|bearer)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      (match) => {
        const separator = /[:=]/u.exec(match)?.[0] ?? "=";
        return `${match.slice(0, match.indexOf(separator) + 1)}***`;
      },
    );
}

/** 思考对象：首句、单行、截断；无可读文本时返回 null（不产出裸行）。 */
function thinkingObject(text: string | null): string | null {
  if (text === null) return null;
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (normalized === "") return null;
  const sentence = normalized.split(/(?<=[。！？!?])/u)[0]?.trim() ?? normalized;
  return scrubLabel(sentence);
}

function readThinkingText(item: Record<string, unknown>): string | null {
  const direct = readString(item.thinking) ?? readString(item.thought);
  if (direct !== null) return direct;
  const delta = isRecord(item.delta) ? item.delta : null;
  const deltaText = readString(delta?.thinking) ?? readString(delta?.text);
  if (deltaText !== null) return deltaText;
  if (Array.isArray(item.summary)) {
    const texts = item.summary.flatMap((entry) => {
      const text = isRecord(entry) ? readString(entry.text) : null;
      return text === null ? [] : [text];
    });
    if (texts.length > 0) return texts.join("\n");
  }
  const content = isRecord(item.content) ? item.content : null;
  return readString(content?.text) ?? readString(content?.thinking) ?? readString(item.text);
}

function readToolName(item: Record<string, unknown>): string | null {
  return readString(item.name) ?? readString(item.tool) ?? readString(item.tool_name) ?? readString(item.title);
}

function readToolInput(item: Record<string, unknown>): string | Record<string, unknown> | null {
  const raw = item.input ?? item.arguments ?? item.args;
  if (typeof raw === "string") return raw;
  if (isRecord(raw)) return raw;
  return null;
}

function readToolCommand(item: Record<string, unknown>): string | null {
  const input = isRecord(item.input) ? item.input : isRecord(item.arguments) ? item.arguments : null;
  return readString(input?.command) ?? readString(input?.cmd) ?? readString(item.command) ?? readString(item.text);
}

function readSkillName(toolInput: string | Record<string, unknown> | null): string | null {
  if (!isRecord(toolInput)) return null;
  return readString(toolInput.skill) ?? readString(toolInput.skill_name) ?? readString(toolInput.name);
}

function readFilePath(value: Record<string, unknown>): string | null {
  const direct = readString(value.path) ?? readString(value.file_path) ?? readString(value.filePath);
  if (direct !== null) return direct;
  if (Array.isArray(value.changes)) {
    const first = value.changes.find(isRecord);
    return first === undefined ? null : readFilePath(first);
  }
  if (isRecord(value.changes)) {
    return Object.keys(value.changes)[0] ?? null;
  }
  return null;
}

function readToolReturnOutput(item: Record<string, unknown>): string | null {
  if (typeof item.output === "string") return item.output;
  if (typeof item.result === "string") return item.result;
  if (typeof item.tools === "string") return item.tools;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) {
    const texts = item.content.flatMap((part) => {
      if (typeof part === "string") return [part];
      if (!isRecord(part)) return [];
      const text = readString(part.text);
      return text === null ? [] : [text];
    });
    return texts.length === 0 ? null : texts.join("\n");
  }
  return null;
}

function readToolReturnFailed(itemType: string, item: Record<string, unknown>): boolean {
  const status = readString(item.status);
  if (status === "failed" || status === "error") return true;
  if (item.is_error === true || item.isError === true) return true;
  if (itemType === "command_execution" && typeof item.exit_code === "number" && item.exit_code !== 0) {
    return true;
  }
  return false;
}

function readToolReturnError(itemType: string, item: Record<string, unknown>): string | null {
  const direct = readString(item.error) ?? readString(item.stderr) ?? readString(item.message);
  if (direct !== null) return direct;
  const output = readToolReturnOutput(item);
  // 输出里本身有可读错误说明时用输出；只有纯退出码时才退到退出码。
  if (output !== null && firstContentfulErrorLine(output) !== null) return output;
  if (typeof item.exit_code === "number") {
    return `exit code ${String(item.exit_code)}`;
  }
  return null;
}

/** 错误说明：第一句有内容的行；整段只有退出码时才保留退出码（视图会跳过）。 */
function firstContentfulErrorLine(value: string | null): string | null {
  if (value === null) return null;
  const lines = value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (lines.length === 0) return null;
  const readable = lines.find((entry) => !PURE_EXIT_CODE_LINE.test(entry));
  return (readable ?? lines[0]!).slice(0, 96);
}

const PURE_EXIT_CODE_LINE = /^(?:exit(?:ed)?(?:\s+with)?(?:\s+code)?|退出码)\s*[:=]?\s*-?\d+\.?$/iu;

function activityPriority(kind: LocalRunActivityKind): number {
  return kind === "command" || kind === "tool"
    ? 3
    : kind === "search" || kind === "read" || kind === "edit"
      ? 2
      : 1;
}

function isCommandType(type: string | null): boolean {
  return type?.includes("command") === true || type === "exec_command" || type === "shell";
}

function isSearchType(type: string | null): boolean {
  return type?.includes("search") === true;
}

function isFileType(type: string | null): boolean {
  return type?.includes("file") === true
    || type?.includes("patch") === true
    || type?.includes("read") === true
    || type?.includes("write") === true
    || type?.includes("edit") === true;
}

function isToolType(type: string | null): boolean {
  return type?.includes("tool") === true
    || type?.includes("function") === true
    || type?.includes("mcp") === true
    || type === "tool_use";
}

function isToolReturnType(type: string | null): boolean {
  return type === "tool_result"
    || type === "function_call_output"
    || type === "custom_tool_call_output"
    || type === "tool_search_output"
    || type === "tool.result"
    || type === "tool-finished"
    || type === "tool_call_update";
}

function isThinkingType(type: string | null, item: Record<string, unknown>): boolean {
  if (type === "thinking" || type === "reasoning" || type === "agent_reasoning" || type === "agent_thought_chunk") {
    return true;
  }
  const delta = isRecord(item.delta) ? item.delta : null;
  return delta?.type === "thinking_delta";
}

function isCommandToolName(name: string | null): boolean {
  return name === "Bash" || name === "exec_command" || name === "shell" || name === "command" || name === "Terminal";
}

function isSkillToolName(name: string | null): boolean {
  return name === "Skill" || name === "skill" || name?.toLowerCase().endsWith("_skill") === true;
}

function isFileToolName(name: string | null): boolean {
  return name === "Read" || name === "Write" || name === "Edit" || name === "MultiEdit" || name === "NotebookEdit";
}

function isSearchToolName(name: string | null): boolean {
  return name === "WebSearch" || name === "WebFetch" || name === "Search";
}

function stripMcpPrefix(name: string | null): string | null {
  if (name === null) return null;
  const match = /^mcp__[^_]+__(.+)$/u.exec(name);
  return match?.[1] ?? name;
}

function readCallId(item: Record<string, unknown>): string | null {
  return readString(item.tool_use_id)
    ?? readString(item.toolCallId)
    ?? readString(item.tool_call_id)
    ?? readString(item.call_id)
    ?? readString(item.callId)
    ?? readString(item.id);
}

function looksSensitive(value: string): boolean {
  return /(?:token|secret|password|authorization|bearer|api[_-]?key)/iu.test(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Cap on trail length: more is no help to the reader and must not grow unbounded. */
export const RUN_ACTIVITY_STEP_LIMIT = 40;

/** 单步输出有界规模（约 12 行）；全量仍只从「完整输出」取得。 */
export const STEP_OUTPUT_LINE_LIMIT = 12;

/** 单步输入上限：命令原文几乎不可能超过，工具参数按此截断。 */
const STEP_INPUT_MAX_CHARS = 4_000;

/**
 * 投影时即裁剪输出：超限时先保留含错误信息的行，再按原顺序补足，并记录被
 * 省略的数量。不把未裁剪的原始输出送进步骤 DTO 或终局持久化步骤。
 */
function boundStepOutput(value: string | null): { text: string; remaining: number } | null {
  if (value === null || value.trim() === "") return null;
  const scrubbed = scrubSecrets(value);
  if (scrubbed.trim() === "") return null;
  const lines = scrubbed.split(/\r?\n/u);
  if (lines.length <= STEP_OUTPUT_LINE_LIMIT) {
    return { text: scrubbed, remaining: 0 };
  }
  const errorIndexes: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line !== undefined && looksLikeErrorLine(line)) errorIndexes.push(index);
  }
  const picked = new Set<number>();
  for (const index of errorIndexes) {
    if (picked.size >= STEP_OUTPUT_LINE_LIMIT) break;
    picked.add(index);
  }
  for (let index = 0; index < lines.length && picked.size < STEP_OUTPUT_LINE_LIMIT; index += 1) {
    if (!picked.has(index)) picked.add(index);
  }
  const kept = [...picked].sort((left, right) => left - right).map((index) => lines[index] ?? "");
  return {
    text: kept.join("\n"),
    remaining: lines.length - picked.size,
  };
}

function looksLikeErrorLine(line: string): boolean {
  return /error|failed|failure|exception|fatal|denied|traceback|错误|失败|异常|未找到|E\d{3,}/iu.test(line);
}

function boundStepInput(value: string | null): string | null {
  if (value === null) return null;
  const scrubbed = scrubSecrets(value).trim();
  if (scrubbed === "") return null;
  return scrubbed.length > STEP_INPUT_MAX_CHARS ? scrubbed.slice(0, STEP_INPUT_MAX_CHARS) : scrubbed;
}

/**
 * Fold one activity into the run's step trail.
 *
 * `progress` is the streaming answer, not a step. A tool return carries the
 * provider call identity and closes the matching call's step with its bounded
 * output and failure state instead of appending a second row — otherwise a
 * single tool call would produce an empty "return" step (the old 70% blank
 * rows). A return with no recorded start must not surface as an empty row.
 * Thinking deltas refresh the ongoing thought row; repeats of the same
 * kind+object with a phase change close that step in place.
 */
export function foldRunActivityStep(
  steps: readonly LocalRunActivity[],
  candidate: LocalRunActivity,
): readonly LocalRunActivity[] {
  if (candidate.kind === "progress") return steps;

  if (candidate.callId !== null && candidate.callId !== undefined) {
    const index = steps.findIndex((step) => step.callId === candidate.callId);
    if (index >= 0) {
      const existing = steps[index]!;
      const merged: LocalRunActivity = {
        ...existing,
        ...(candidate.object !== null ? { object: candidate.object } : {}),
        ...(candidate.input !== undefined ? { input: candidate.input } : {}),
        ...(candidate.phase === "completed"
          ? {
              phase: "completed" as const,
              ...(candidate.output === undefined ? {} : { output: candidate.output }),
              ...(candidate.outputRemainingLines === undefined ? {} : { outputRemainingLines: candidate.outputRemainingLines }),
              ...(candidate.error === undefined ? {} : { error: candidate.error }),
              occurredAt: candidate.occurredAt,
            }
          : {}),
      };
      return [...steps.slice(0, index), merged, ...steps.slice(index + 1)];
    }
    if (candidate.phase === "completed") return steps;
  }

  const last = steps.at(-1);
  if (
    candidate.kind === "thinking"
    && candidate.phase === "running"
    && last?.kind === "thinking"
    && last.phase === "running"
  ) {
    return [...steps.slice(0, -1), candidate];
  }
  if (last !== undefined && last.kind === candidate.kind && last.object === candidate.object) {
    return candidate.phase === last.phase
      ? steps
      : [...steps.slice(0, -1), candidate];
  }
  const appended = [...steps, candidate];
  return appended.length > RUN_ACTIVITY_STEP_LIMIT
    ? appended.slice(appended.length - RUN_ACTIVITY_STEP_LIMIT)
    : appended;
}
