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
}

/**
 * Providers wrap the interesting item in an envelope, and each one nests it
 * differently: Codex puts it in `item`/`payload`, Claude streams it as
 * `stream_event.event.content_block` and repeats it in `message.content[]`.
 * Reading only the outer `type` sees "stream_event" and loses both the tool
 * name and the thinking block, which is why the trail used to be a wall of
 * identical "using a tool" lines.
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
  const itemType = readString(item.type) ?? eventType;
  const phase = eventType?.includes("completed") === true
    || eventType?.includes("_end") === true
    || readString(item.status) === "completed"
    ? "completed"
    : "running";

  if (isCommandType(itemType)) {
    const command = readString(item.command) ?? readString(item.text) ?? readString(item.input);
    return activity(cursor, "command", phase, safeCommandObject(command), occurredAt);
  }
  if (isSearchType(itemType)) {
    const query = readString(item.query) ?? readString(item.input);
    return activity(cursor, "search", phase, safeQuotedObject(query), occurredAt);
  }
  if (isFileType(itemType)) {
    const filePath = readFilePath(item);
    const edit = itemType?.includes("change") === true
      || itemType?.includes("patch") === true
      || itemType?.includes("write") === true
      || itemType?.includes("edit") === true;
    return activity(cursor, edit ? "edit" : "read", phase, safeFileObject(filePath), occurredAt);
  }
  if (itemType === "thinking") {
    return activity(cursor, "thinking", phase, null, occurredAt);
  }
  if (isToolType(itemType)) {
    const name = safeLabel(
      readString(item.name)
      ?? readString(item.tool)
      ?? readString(item.tool_name)
      ?? readString(item.server),
    );
    return activity(cursor, "tool", phase, name, occurredAt);
  }
  return null;
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
  return { cursor, kind, phase, action: `${verb}${noun}`, object, occurredAt };
}

function safeCommandObject(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.replace(/[\r\n]+/gu, " ").trim();
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

function safeQuotedObject(value: string | null): string | null {
  const label = safeLabel(value);
  return label === null ? null : `“${label}”`;
}

function safeFileObject(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  return safeLabel(path.basename(value.replaceAll("\\", "/")));
}

function safePathToken(value: string): string {
  return value.includes("/") || value.includes("\\")
    ? path.basename(value.replaceAll("\\", "/"))
    : value;
}

function safeLabel(value: string | null): string | null {
  if (value === null) return null;
  const withoutIds = value
    .replace(/\b(?:run|session|thread|call)[_-]?id\s*[:=]\s*\S+/giu, "")
    .replace(/(?:\/[^\s"'`]+)+/gu, (match) => path.basename(match))
    .replace(/\s+/gu, " ")
    .trim();
  return withoutIds === "" ? null : withoutIds.slice(0, 96);
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
    || type?.includes("mcp") === true;
}

function looksSensitive(value: string): boolean {
  return /(?:token|secret|password|authorization|bearer)/iu.test(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Cap on trail length: more is no help to the reader and must not grow unbounded. */
export const RUN_ACTIVITY_STEP_LIMIT = 40;

/**
 * Fold one activity into the run's step trail.
 *
 * `progress` is the streaming answer, not a step. A repeat of the same
 * kind+object is the same step still going, and its `completed` phase closes
 * that step instead of appending a second copy — otherwise a single tool call
 * that emits many deltas would fill the trail with identical lines.
 */
export function foldRunActivityStep(
  steps: readonly LocalRunActivity[],
  candidate: LocalRunActivity,
): readonly LocalRunActivity[] {
  if (candidate.kind === "progress") return steps;
  const last = steps.at(-1);
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
