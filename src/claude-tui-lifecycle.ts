import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, unlink, writeFile } from "node:fs/promises";
import type http from "node:http";
import path from "node:path";

import {
  CLAUDE_TUI_LIFECYCLE_HOOK_MAX_BYTES,
  CLAUDE_TUI_LIFECYCLE_HOOK_TIMEOUT_SECONDS,
} from "./config.js";

export const CLAUDE_TUI_LIFECYCLE_HOOK_PATH = "/api/local-console/internal/claude-tui-lifecycle";
export const CLAUDE_TUI_LIFECYCLE_CAPABILITY_HEADER = "x-moebius-claude-lifecycle-capability";

type ClaudeTuiHookEventName = "UserPromptSubmit" | "Stop" | "SessionEnd";
type ClaudeTuiLifecyclePhase = "prepared" | "ready" | "turn-active" | "ended";

export type ClaudeTuiLifecycleEvent =
  | { type: "session-started"; sessionId: string }
  | { type: "turn-submitted"; sessionId: string }
  | { type: "turn-stopped"; sessionId: string }
  | { type: "session-ended"; sessionId: string };

export interface ClaudeTuiLifecycleHandle {
  readonly sessionId: string;
  readonly settingsPath: string;
  writeSettings(): Promise<void>;
  markSessionStarted(): void;
  dispose(): Promise<void>;
}

export class ClaudeTuiLifecycleError extends Error {
  constructor(readonly code:
    | "claude-tui-lifecycle-origin-unavailable"
    | "claude-tui-lifecycle-settings-unwritten"
    | "claude-tui-lifecycle-already-started") {
    super(code);
    this.name = "ClaudeTuiLifecycleError";
  }
}

interface LifecycleRegistration {
  capability: string;
  sessionId: string;
  settingsPath: string;
  phase: ClaudeTuiLifecyclePhase;
  settingsWritten: boolean;
  stoppedTurn: boolean;
  onEvent?: (event: ClaudeTuiLifecycleEvent) => void;
}

export class ClaudeTuiLifecycleReceiver {
  private readonly registrations = new Map<string, LifecycleRegistration>();
  private endpoint: URL | null = null;

  constructor(private readonly options: {
    maxBodyBytes?: number;
  } = {}) {}

  setLoopbackOrigin(origin: string | URL): void {
    const endpoint = new URL(CLAUDE_TUI_LIFECYCLE_HOOK_PATH, origin);
    assertLoopbackEndpoint(endpoint);
    this.endpoint = endpoint;
  }

  createSession(input: {
    sessionId: string;
    runDir: string;
    onEvent?: (event: ClaudeTuiLifecycleEvent) => void;
  }): ClaudeTuiLifecycleHandle {
    if (this.endpoint === null) {
      throw new ClaudeTuiLifecycleError("claude-tui-lifecycle-origin-unavailable");
    }
    const capability = randomBytes(32).toString("base64url");
    const registration: LifecycleRegistration = {
      capability,
      sessionId: input.sessionId,
      settingsPath: path.join(path.resolve(input.runDir), "claude-tui-lifecycle-settings.json"),
      phase: "prepared",
      settingsWritten: false,
      stoppedTurn: false,
      onEvent: input.onEvent,
    };
    this.registrations.set(capability, registration);

    return {
      sessionId: registration.sessionId,
      settingsPath: registration.settingsPath,
      writeSettings: async () => {
        await this.writeSettings(registration);
      },
      markSessionStarted: () => {
        this.markSessionStarted(registration);
      },
      dispose: async () => {
        await this.dispose(registration);
      },
    };
  }

  async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== CLAUDE_TUI_LIFECYCLE_HOOK_PATH) return false;
    if (request.method !== "POST") {
      discard(request);
      sendStatus(response, 405);
      return true;
    }
    if (!isJsonContentType(request.headers["content-type"])) {
      discard(request);
      sendStatus(response, 415);
      return true;
    }
    const registration = this.registrationFor(readSingleHeader(request.headers[CLAUDE_TUI_LIFECYCLE_CAPABILITY_HEADER]));
    if (registration === undefined) {
      discard(request);
      sendStatus(response, 403);
      return true;
    }
    const maxBodyBytes = this.options.maxBodyBytes ?? CLAUDE_TUI_LIFECYCLE_HOOK_MAX_BYTES;
    if (declaredBodyBytesExceed(request.headers["content-length"], maxBodyBytes)) {
      discard(request);
      sendStatus(response, 413);
      return true;
    }
    let payload: unknown;
    try {
      payload = JSON.parse((await readBoundedBody(request, maxBodyBytes)).toString("utf8"));
    } catch (error) {
      sendStatus(response, error instanceof LifecyclePayloadTooLargeError ? 413 : 400);
      return true;
    }
    sendStatus(response, await this.accept(registration, payload));
    return true;
  }

  private async writeSettings(registration: LifecycleRegistration): Promise<void> {
    if (registration.settingsWritten) return;
    const endpoint = this.endpoint;
    if (endpoint === null) {
      throw new ClaudeTuiLifecycleError("claude-tui-lifecycle-origin-unavailable");
    }
    await mkdir(path.dirname(registration.settingsPath), { recursive: true, mode: 0o700 });
    try {
      await writeFile(
        registration.settingsPath,
        JSON.stringify(createSettings(endpoint, registration.capability)),
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      await chmod(registration.settingsPath, 0o600);
      registration.settingsWritten = true;
    } catch (error) {
      await unlink(registration.settingsPath).catch(() => undefined);
      throw error;
    }
  }

  private markSessionStarted(registration: LifecycleRegistration): void {
    if (!registration.settingsWritten) {
      throw new ClaudeTuiLifecycleError("claude-tui-lifecycle-settings-unwritten");
    }
    if (registration.phase !== "prepared") {
      throw new ClaudeTuiLifecycleError("claude-tui-lifecycle-already-started");
    }
    registration.phase = "ready";
    this.emit(registration, { type: "session-started", sessionId: registration.sessionId });
  }

  private async accept(registration: LifecycleRegistration, payload: unknown): Promise<number> {
    const event = selectHookEvent(payload, registration.sessionId);
    if (event === null) return 400;
    switch (event) {
      case "UserPromptSubmit": {
        if (registration.phase === "prepared" || registration.phase === "ended") return 409;
        if (registration.phase === "turn-active") return 204;
        registration.phase = "turn-active";
        registration.stoppedTurn = false;
        return this.emitAndStatus(registration, { type: "turn-submitted", sessionId: registration.sessionId });
      }
      case "Stop": {
        if (registration.phase === "prepared" || registration.phase === "ended") return 409;
        if (registration.phase === "ready") return registration.stoppedTurn ? 204 : 409;
        registration.phase = "ready";
        registration.stoppedTurn = true;
        return this.emitAndStatus(registration, { type: "turn-stopped", sessionId: registration.sessionId });
      }
      case "SessionEnd": {
        if (registration.phase === "prepared") return 409;
        if (registration.phase === "ended") return 204;
        registration.phase = "ended";
        const status = this.emitAndStatus(registration, { type: "session-ended", sessionId: registration.sessionId });
        await this.dispose(registration);
        return status;
      }
    }
  }

  private emitAndStatus(registration: LifecycleRegistration, event: ClaudeTuiLifecycleEvent): number {
    try {
      this.emit(registration, event);
      return 204;
    } catch {
      return 500;
    }
  }

  private emit(registration: LifecycleRegistration, event: ClaudeTuiLifecycleEvent): void {
    registration.onEvent?.(event);
  }

  private registrationFor(capability: string | undefined): LifecycleRegistration | undefined {
    if (capability === undefined) return undefined;
    for (const registration of this.registrations.values()) {
      if (capabilitiesEqual(capability, registration.capability)) return registration;
    }
    return undefined;
  }

  private async dispose(registration: LifecycleRegistration): Promise<void> {
    this.registrations.delete(registration.capability);
    if (!registration.settingsWritten) return;
    registration.settingsWritten = false;
    await unlink(registration.settingsPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

function createSettings(endpoint: URL, capability: string): object {
  const handler = {
    type: "http",
    url: endpoint.toString(),
    timeout: CLAUDE_TUI_LIFECYCLE_HOOK_TIMEOUT_SECONDS,
    headers: { "X-Moebius-Claude-Lifecycle-Capability": capability },
  };
  return {
    hooks: {
      UserPromptSubmit: [{ hooks: [handler] }],
      Stop: [{ hooks: [handler] }],
      SessionEnd: [{ hooks: [handler] }],
    },
  };
}

function selectHookEvent(payload: unknown, expectedSessionId: string): ClaudeTuiHookEventName | null {
  if (!isRecord(payload) || payload.session_id !== expectedSessionId) return null;
  switch (payload.hook_event_name) {
    case "UserPromptSubmit":
    case "Stop":
    case "SessionEnd":
      return payload.hook_event_name;
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function capabilitiesEqual(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return candidateBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(candidateBytes, expectedBytes);
}

function assertLoopbackEndpoint(endpoint: URL): void {
  if (
    endpoint.protocol !== "http:"
    || (endpoint.hostname !== "127.0.0.1" && endpoint.hostname !== "[::1]" && endpoint.hostname !== "::1")
    || endpoint.port === ""
    || endpoint.pathname !== CLAUDE_TUI_LIFECYCLE_HOOK_PATH
    || endpoint.search !== ""
    || endpoint.hash !== ""
  ) {
    throw new Error("claude-tui-lifecycle-endpoint-must-be-private-loopback");
  }
}

function readSingleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isJsonContentType(value: string | string[] | undefined): boolean {
  const contentType = readSingleHeader(value);
  return contentType !== undefined && /^application\/json(?:\s*;|$)/iu.test(contentType);
}

function declaredBodyBytesExceed(value: string | string[] | undefined, maxBytes: number): boolean {
  const declared = readSingleHeader(value);
  if (declared === undefined) return false;
  const bytes = Number(declared);
  return Number.isSafeInteger(bytes) && bytes > maxBytes;
}

function discard(request: http.IncomingMessage): void {
  request.resume();
}

function sendStatus(response: http.ServerResponse, statusCode: number): void {
  response.writeHead(statusCode);
  response.end();
}

class LifecyclePayloadTooLargeError extends Error {}

async function readBoundedBody(request: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    size += chunk.byteLength;
    if (size > maxBytes) throw new LifecyclePayloadTooLargeError();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
