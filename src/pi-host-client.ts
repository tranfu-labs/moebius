import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  PiHostFrameDecoder,
  PI_HOST_TERMINATE_GRACE_MS,
  encodePiHostFrame,
  parsePiHostOutputFrame,
  type PiHostOutputFrame,
  type PiHostStartFrame,
} from "./pi-host-protocol.js";

export interface PiHostClientOptions {
  hostEntryPath: string;
  nodePath?: string;
  spawnHost?: (nodePath: string, args: readonly string[]) => ChildProcessWithoutNullStreams;
  terminateGraceMs?: number;
}

export interface PiHostInvocationResult {
  terminal: Extract<PiHostOutputFrame, { type: "completed" | "validated" }>;
  session: Extract<PiHostOutputFrame, { type: "session-observed" }> | null;
}

export class PiHostClient {
  readonly #hostEntryPath: string;
  readonly #nodePath: string;
  readonly #spawnHost: NonNullable<PiHostClientOptions["spawnHost"]>;
  readonly #terminateGraceMs: number;

  constructor(options: PiHostClientOptions) {
    this.#hostEntryPath = options.hostEntryPath;
    this.#nodePath = options.nodePath ?? process.execPath;
    this.#terminateGraceMs = options.terminateGraceMs ?? PI_HOST_TERMINATE_GRACE_MS;
    this.#spawnHost = options.spawnHost ?? ((nodePath, args) => spawn(nodePath, [...args], {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: createPiHostEnvironment(process.env, process.versions.electron !== undefined),
    }));
  }

  async invoke(input: {
    frame: PiHostStartFrame;
    signal?: AbortSignal;
    onEvent?: (event: PiHostOutputFrame) => void;
  }): Promise<PiHostInvocationResult> {
    const child = this.#spawnHost(this.#nodePath, [this.#hostEntryPath]);
    const decoder = new PiHostFrameDecoder();
    let startSent = false;
    let terminal: PiHostInvocationResult["terminal"] | undefined;
    let session: PiHostInvocationResult["session"] = null;
    let safeFailure: Extract<PiHostOutputFrame, { type: "failed" }> | undefined;

    return await new Promise<PiHostInvocationResult>((resolve, reject) => {
      let finished = false;
      let terminateTimer: NodeJS.Timeout | undefined;
      let forceTimer: NodeJS.Timeout | undefined;
      const cleanup = () => {
        child.stdout.off("data", onStdout);
        child.stderr.off("data", onStderr);
        child.off("error", onError);
        child.off("close", onClose);
        input.signal?.removeEventListener("abort", onAbort);
        if (terminateTimer !== undefined) clearTimeout(terminateTimer);
        if (forceTimer !== undefined) clearTimeout(forceTimer);
      };
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        cleanup();
        if (error !== undefined) reject(error);
        else if (safeFailure !== undefined) reject(new PiHostClientError(safeFailure.reason, safeFailure.message));
        else if (terminal !== undefined) resolve({ terminal, session });
        else reject(new PiHostClientError("crashed", "Pi Host 未返回完整结果。"));
      };
      const onStdout = (chunk: Buffer) => {
        try {
          for (const raw of decoder.push(chunk)) {
            const event = parsePiHostOutputFrame(raw);
            input.onEvent?.(event);
            if (event.type === "ready" && !startSent) {
              startSent = true;
              child.stdin.write(encodePiHostFrame(input.frame));
            } else if (event.type === "session-observed") {
              session = event;
            } else if (event.type === "completed" || event.type === "validated") {
              terminal = event;
            } else if (event.type === "failed") {
              safeFailure = event;
            }
          }
        } catch (error) {
          child.kill("SIGTERM");
          finish(error instanceof Error ? error : new Error("Pi Host protocol failed"));
        }
      };
      const onStderr = (chunk: Buffer) => {
        // Always drain the pipe so a verbose dependency cannot deadlock the Host.
        // Provider stderr is intentionally excluded from user-visible and ordinary diagnostic output.
        if (process.env.MOEBIUS_TRUSTED_PI_DIAGNOSTICS === "1") {
          process.stderr.write(chunk.toString("utf8").split(input.frame.credential.apiKey).join("[redacted]"));
        }
      };
      const onError = () => finish(new PiHostClientError("crashed", "无法启动 Pi Host。"));
      const onClose = () => {
        try {
          decoder.finish();
          finish();
        } catch (error) {
          finish(error instanceof Error ? error : new Error("Pi Host stream ended unexpectedly"));
        }
      };
      const onAbort = () => {
        if (child.stdin.writable && startSent) {
          child.stdin.write(encodePiHostFrame({ version: 1, type: "cancel" }));
        } else {
          child.kill("SIGTERM");
        }
        terminateTimer ??= setTimeout(() => {
          child.kill("SIGTERM");
          forceTimer ??= setTimeout(() => child.kill("SIGKILL"), this.#terminateGraceMs);
        }, this.#terminateGraceMs);
      };
      child.stdout.on("data", onStdout);
      child.stderr.on("data", onStderr);
      child.once("error", onError);
      child.once("close", onClose);
      input.signal?.addEventListener("abort", onAbort, { once: true });
      if (input.signal?.aborted) onAbort();
    });
  }
}

const SENSITIVE_ENVIRONMENT_NAME = /(?:api_?key|token|secret|password|authorization|credential|private_?key)/iu;

function createPiHostEnvironment(
  source: NodeJS.ProcessEnv,
  electronRunAsNode: boolean,
): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(source).filter(([name]) => !SENSITIVE_ENVIRONMENT_NAME.test(name)),
  );
  return electronRunAsNode ? { ...environment, ELECTRON_RUN_AS_NODE: "1" } : environment;
}

export class PiHostClientError extends Error {
  constructor(
    readonly code:
      | "auth"
      | "model-unavailable"
      | "model-incompatible"
      | "rate-limited"
      | "quota"
      | "network"
      | "provider-unavailable"
      | "no-complete-result"
      | "crashed"
      | "cancelled",
    message: string,
  ) {
    super(message);
    this.name = "PiHostClientError";
  }
}
