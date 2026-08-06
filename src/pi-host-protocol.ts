import type { DeepSeekModelId, PiEffort } from "./provider-profile.js";

export const PI_HOST_PROTOCOL_VERSION = 1;
export const PI_HOST_MAX_FRAME_BYTES = 8 * 1024 * 1024;
export const PI_HOST_MAX_TOOL_OUTPUT_BYTES = 2 * 1024 * 1024;
export const PI_HOST_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const PI_HOST_WEB_FETCH_TIMEOUT_MS = 30_000;
export const PI_HOST_COMMAND_TERMINATE_GRACE_MS = 2_000;
export const PI_HOST_TERMINATE_GRACE_MS = 2_000;
export const PI_HOST_MAX_FOREGROUND_SUBAGENTS = 4;

export type PiHostStartFrame = {
  version: typeof PI_HOST_PROTOCOL_VERSION;
  type: "start";
  credential: { apiKey: string };
  invocation:
    | {
        kind: "validate";
        providerId: "deepseek";
        model: DeepSeekModelId;
        effort: PiEffort;
        cwd: string;
        agentDir: string;
      }
    | {
        kind: "run";
        providerId: "deepseek";
        model: DeepSeekModelId;
        effort: PiEffort;
        cwd: string;
        agentDir: string;
        sessionDir: string;
        nativeSessionPath: string | null;
        prompt: string;
        imagePaths: string[];
        managedProcessMcp: {
          command: string;
          args: string[];
          env: Record<string, string>;
        } | null;
      };
};

export type PiHostControlFrame =
  | { version: typeof PI_HOST_PROTOCOL_VERSION; type: "cancel" };

export type PiHostInputFrame = PiHostStartFrame | PiHostControlFrame;

export type PiHostSafeFailure =
  | "auth"
  | "model-unavailable"
  | "model-incompatible"
  | "rate-limited"
  | "quota"
  | "network"
  | "provider-unavailable"
  | "no-complete-result"
  | "crashed"
  | "cancelled";

export type PiHostOutputFrame =
  | { version: 1; type: "ready" }
  | { version: 1; type: "session-observed"; sessionId: string; sessionPath: string | null }
  | { version: 1; type: "assistant-delta"; delta: string }
  | { version: 1; type: "reasoning-delta"; delta: string }
  | { version: 1; type: "tool-started"; toolCallId: string; toolName: string; safeSummary: string }
  | { version: 1; type: "tool-finished"; toolCallId: string; toolName: string; isError: boolean }
  | { version: 1; type: "compacted" }
  | { version: 1; type: "completed"; body: string }
  | { version: 1; type: "validated"; replied: true; toolCalled: true }
  | { version: 1; type: "failed"; reason: PiHostSafeFailure; message: string };

export function encodePiHostFrame(value: PiHostInputFrame | PiHostOutputFrame): Buffer {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.byteLength > PI_HOST_MAX_FRAME_BYTES) {
    throw new PiHostProtocolError("PI_HOST_FRAME_TOO_LARGE", "Pi Host frame exceeds the maximum size");
  }
  const frame = Buffer.allocUnsafe(4 + payload.byteLength);
  frame.writeUInt32BE(payload.byteLength, 0);
  payload.copy(frame, 4);
  return frame;
}

export class PiHostFrameDecoder {
  #buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    const values: unknown[] = [];
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32BE(0);
      if (length === 0 || length > PI_HOST_MAX_FRAME_BYTES) {
        throw new PiHostProtocolError("PI_HOST_FRAME_INVALID", "Pi Host frame length is invalid");
      }
      if (this.#buffer.length < length + 4) {
        break;
      }
      const payload = this.#buffer.subarray(4, 4 + length);
      this.#buffer = this.#buffer.subarray(4 + length);
      try {
        values.push(JSON.parse(payload.toString("utf8")) as unknown);
      } catch {
        throw new PiHostProtocolError("PI_HOST_FRAME_INVALID", "Pi Host frame JSON is invalid");
      }
    }
    return values;
  }

  finish(): void {
    if (this.#buffer.length !== 0) {
      throw new PiHostProtocolError("PI_HOST_FRAME_TRUNCATED", "Pi Host stream ended with a partial frame");
    }
  }
}

export function parsePiHostInputFrame(value: unknown): PiHostInputFrame {
  if (!isRecord(value) || value.version !== PI_HOST_PROTOCOL_VERSION || typeof value.type !== "string") {
    throw new PiHostProtocolError("PI_HOST_FRAME_INVALID", "Pi Host input frame is invalid");
  }
  if (value.type === "cancel") {
    return { version: 1, type: "cancel" };
  }
  if (value.type !== "start" || !isRecord(value.credential) || !isRecord(value.invocation)) {
    throw new PiHostProtocolError("PI_HOST_FRAME_INVALID", "Pi Host start frame is invalid");
  }
  const apiKey = readBoundedString(value.credential.apiKey, "apiKey", 8, 16_384);
  const invocation = value.invocation;
  const common = {
    providerId: readLiteral(invocation.providerId, "deepseek", "providerId"),
    model: readModel(invocation.model),
    effort: readEffort(invocation.effort),
    cwd: readBoundedString(invocation.cwd, "cwd", 1, 16_384),
    agentDir: readBoundedString(invocation.agentDir, "agentDir", 1, 16_384),
  };
  if (invocation.kind === "validate") {
    return { version: 1, type: "start", credential: { apiKey }, invocation: { kind: "validate", ...common } };
  }
  if (invocation.kind === "run") {
    return {
      version: 1,
      type: "start",
      credential: { apiKey },
      invocation: {
        kind: "run",
        ...common,
        sessionDir: readBoundedString(invocation.sessionDir, "sessionDir", 1, 16_384),
        nativeSessionPath: invocation.nativeSessionPath === null
          ? null
          : readBoundedString(invocation.nativeSessionPath, "nativeSessionPath", 1, 16_384),
        prompt: readBoundedString(invocation.prompt, "prompt", 1, 4 * 1024 * 1024),
        imagePaths: readStringArray(invocation.imagePaths, "imagePaths", 16, 16_384),
        managedProcessMcp: invocation.managedProcessMcp === null
          ? null
          : readManagedProcessMcp(invocation.managedProcessMcp),
      },
    };
  }
  throw new PiHostProtocolError("PI_HOST_FRAME_INVALID", "Pi Host invocation kind is invalid");
}

export function parsePiHostOutputFrame(value: unknown): PiHostOutputFrame {
  if (!isRecord(value) || value.version !== 1 || typeof value.type !== "string") {
    throw new PiHostProtocolError("PI_HOST_FRAME_INVALID", "Pi Host output frame is invalid");
  }
  switch (value.type) {
    case "ready":
      return { version: 1, type: "ready" };
    case "session-observed":
      return {
        version: 1,
        type: "session-observed",
        sessionId: readBoundedString(value.sessionId, "sessionId", 1, 512),
        sessionPath: value.sessionPath === null ? null : readBoundedString(value.sessionPath, "sessionPath", 1, 16_384),
      };
    case "assistant-delta":
    case "reasoning-delta":
      return { version: 1, type: value.type, delta: readBoundedString(value.delta, "delta", 1, 1024 * 1024) };
    case "tool-started":
      return {
        version: 1,
        type: "tool-started",
        toolCallId: readBoundedString(value.toolCallId, "toolCallId", 1, 512),
        toolName: readBoundedString(value.toolName, "toolName", 1, 256),
        safeSummary: readBoundedString(value.safeSummary, "safeSummary", 1, 1024),
      };
    case "tool-finished":
      return {
        version: 1,
        type: "tool-finished",
        toolCallId: readBoundedString(value.toolCallId, "toolCallId", 1, 512),
        toolName: readBoundedString(value.toolName, "toolName", 1, 256),
        isError: readBoolean(value.isError, "isError"),
      };
    case "compacted":
      return { version: 1, type: "compacted" };
    case "completed":
      return { version: 1, type: "completed", body: readBoundedString(value.body, "body", 1, 4 * 1024 * 1024) };
    case "validated":
      if (value.replied !== true || value.toolCalled !== true) {
        throw new PiHostProtocolError("PI_HOST_FRAME_INVALID", "Pi Host validation result is invalid");
      }
      return { version: 1, type: "validated", replied: true, toolCalled: true };
    case "failed":
      return {
        version: 1,
        type: "failed",
        reason: readFailure(value.reason),
        message: readBoundedString(value.message, "message", 1, 2048),
      };
    default:
      throw new PiHostProtocolError("PI_HOST_FRAME_INVALID", "Pi Host output type is invalid");
  }
}

export class PiHostProtocolError extends Error {
  constructor(
    readonly code: "PI_HOST_FRAME_TOO_LARGE" | "PI_HOST_FRAME_INVALID" | "PI_HOST_FRAME_TRUNCATED",
    message: string,
  ) {
    super(message);
    this.name = "PiHostProtocolError";
  }
}

function readFailure(value: unknown): PiHostSafeFailure {
  const allowed: readonly PiHostSafeFailure[] = [
    "auth", "model-unavailable", "model-incompatible", "rate-limited", "quota", "network",
    "provider-unavailable", "no-complete-result", "crashed", "cancelled",
  ];
  if (typeof value === "string" && allowed.includes(value as PiHostSafeFailure)) {
    return value as PiHostSafeFailure;
  }
  throw new PiHostProtocolError("PI_HOST_FRAME_INVALID", "Pi Host failure reason is invalid");
}

function readModel(value: unknown): DeepSeekModelId {
  if (value === "deepseek-v4-flash" || value === "deepseek-v4-pro") return value;
  throw new PiHostProtocolError("PI_HOST_FRAME_INVALID", "Pi Host model is invalid");
}

function readEffort(value: unknown): PiEffort {
  if (value === "high" || value === "max") return value;
  throw new PiHostProtocolError("PI_HOST_FRAME_INVALID", "Pi Host effort is invalid");
}

function readBoundedString(value: unknown, field: string, minimum: number, maximum: number): string {
  if (
    typeof value !== "string"
    || value.length < minimum
    || value.length > maximum
    || /\0/u.test(value)
  ) {
    throw new PiHostProtocolError("PI_HOST_FRAME_INVALID", `Pi Host ${field} is invalid`);
  }
  return value;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new PiHostProtocolError("PI_HOST_FRAME_INVALID", `Pi Host ${field} is invalid`);
  }
  return value;
}

function readLiteral<T extends string>(value: unknown, expected: T, field: string): T {
  if (value !== expected) {
    throw new PiHostProtocolError("PI_HOST_FRAME_INVALID", `Pi Host ${field} is invalid`);
  }
  return expected;
}

function readStringArray(value: unknown, field: string, maximumItems: number, maximumLength: number): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new PiHostProtocolError("PI_HOST_FRAME_INVALID", `Pi Host ${field} is invalid`);
  }
  return value.map((item, index) => readBoundedString(item, `${field}[${String(index)}]`, 1, maximumLength));
}

function readManagedProcessMcp(value: unknown): NonNullable<RunInvocationShape["managedProcessMcp"]> {
  if (!isRecord(value) || !isRecord(value.env)) {
    throw new PiHostProtocolError("PI_HOST_FRAME_INVALID", "Pi Host managedProcessMcp is invalid");
  }
  const entries = Object.entries(value.env);
  if (entries.length > 64) {
    throw new PiHostProtocolError("PI_HOST_FRAME_INVALID", "Pi Host managedProcessMcp env is too large");
  }
  return {
    command: readBoundedString(value.command, "managedProcessMcp.command", 1, 16_384),
    args: readStringArray(value.args, "managedProcessMcp.args", 64, 16_384),
    env: Object.fromEntries(entries.map(([key, item]) => [
      readBoundedString(key, "managedProcessMcp.env key", 1, 256),
      readBoundedString(item, `managedProcessMcp.env.${key}`, 0, 16_384),
    ])),
  };
}

type RunInvocationShape = Extract<PiHostStartFrame["invocation"], { kind: "run" }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
