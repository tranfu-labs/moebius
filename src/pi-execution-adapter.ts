import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexRunResult } from "./codex.js";
import { planExecutionFailureTerminal, type CodexRunFailure } from "./execution-failure-plan.js";
import { PiHostClient, PiHostClientError } from "./pi-host-client.js";
import type { PiHostOutputFrame } from "./pi-host-protocol.js";
import { normalizeProviderModel, planProviderRuntimeFailureReason } from "./provider-profile.js";
import type { SafeProviderReason } from "./provider-profile.js";
import type { LocalExecutionMode, PiExecutionRunOptions } from "./local-console/execution-driver.js";

type PiProfile = PiExecutionRunOptions["profile"];

export type PiProviderProfileUnavailableKind = "disabled" | "needs-attention" | "missing";

/**
 * Raised before the Pi host is invoked when the frozen Provider profile cannot
 * execute a new turn. This is a product state, not a host crash: callers need
 * to preserve the user message and expose the matching recovery actions.
 */
export class PiProviderProfileUnavailableError extends Error {
  readonly code = "pi-provider-profile-unavailable" as const;

  constructor(
    readonly kind: PiProviderProfileUnavailableKind,
    message: string,
  ) {
    super(message);
    this.name = "PiProviderProfileUnavailableError";
  }
}

export interface PiExecutionAdapterOptions {
  dataRoot: string;
  hostEntryPath: string;
  readCredential(profileId: string): Promise<string>;
  reportProviderFailure?(profileId: string, reason: SafeProviderReason): Promise<void>;
  client?: PiHostClient;
}

export function createPiExecutionAdapter(options: PiExecutionAdapterOptions) {
  const client = options.client ?? new PiHostClient({ hostEntryPath: options.hostEntryPath });
  return async (input: PiExecutionRunOptions & { profile: PiProfile }): Promise<CodexRunResult> => {
    const tracePath = path.join(options.dataRoot, ".state", "pi-traces", `${randomUUID()}.jsonl`);
    const errorPath = path.join(input.runDir, "pi-error.txt");
    await Promise.all([
      mkdir(input.runDir, { recursive: true }),
      mkdir(path.dirname(tracePath), { recursive: true, mode: 0o700 }),
    ]);
    await writeFile(tracePath, "", { encoding: "utf8", mode: 0o600 });
    await writeFile(errorPath, "", { encoding: "utf8", mode: 0o600 });
    const sessionDir = piSessionDirectory(options.dataRoot, input.profile.providerProfileId, input.cwd);
    let sequence = 0;
    let partialText = "";
    let externalSessionId: string | null = null;
    let traceTail = Promise.resolve();
    try {
      const apiKey = await options.readCredential(input.profile.providerProfileId);
      await input.onProcessStarted?.();
      const result = await client.invoke({
        frame: {
          version: 1,
          type: "start",
          credential: { apiKey },
          invocation: {
            kind: "run",
            providerId: input.profile.providerId,
            model: normalizeProviderModel("deepseek", input.profile.model),
            effort: normalizePiEffort(input.profile.effort),
            cwd: input.cwd,
            agentDir: path.join(options.dataRoot, ".pi-agent"),
            sessionDir,
            nativeSessionPath: resolveNativeSessionPath(input.mode),
            prompt: input.prompt,
            imagePaths: input.imagePaths ?? [],
            managedProcessMcp: input.mcpServer === undefined ? null : {
              command: input.mcpServer.command,
              args: [...input.mcpServer.args],
              env: { ...input.mcpServer.env },
            },
          },
        },
        signal: input.signal,
        onEvent: (event) => {
          traceTail = traceTail.then(() => appendSafeTrace(tracePath, event));
          input.onStructuredActivity?.(event);
          sequence += 1;
          if (event.type === "session-observed") {
            externalSessionId = event.sessionPath;
            if (event.sessionPath !== null) void input.onSessionStarted?.({ engine: "pi", externalSessionId: event.sessionPath });
          } else if (event.type === "assistant-delta") {
            partialText += event.delta;
            input.onVisibleAgentMarkdown?.(partialText);
            input.onExecutionProgress?.({ kind: "assistant-output", delta: event.delta, sequence });
          } else if (event.type === "reasoning-delta") {
            input.onExecutionProgress?.({ kind: "reasoning-output", delta: event.delta, sequence });
          } else if (event.type === "tool-started" || event.type === "tool-finished") {
            input.onExecutionProgress?.({
              kind: event.type === "tool-started" ? "tool-started" : "tool-finished",
              toolId: event.toolCallId,
              toolKind: event.toolName,
              sequence,
            });
          }
        },
      });
      await traceTail;
      if (result.terminal.type !== "completed" || result.session?.sessionPath === null || result.session === null) {
        return failedResult(input, tracePath, errorPath, "pi-no-complete-result", "Pi API 没有返回完整结果。", partialText);
      }
      externalSessionId = result.session.sessionPath;
      await input.onExecutionTraceReady?.({ engine: "pi", externalSessionId, tracePath });
      return {
        ok: true,
        finalText: result.terminal.body,
        threadId: externalSessionId,
        cachedInputTokens: null,
        runDir: input.runDir,
        stdoutPath: tracePath,
        stderrPath: errorPath,
        terminal: { kind: "completed", externalSessionId, finalText: result.terminal.body },
      };
    } catch (error) {
      await traceTail.catch(() => undefined);
      const providerReason = providerFailureReason(error);
      if (providerReason !== null) {
        await options.reportProviderFailure?.(input.profile.providerProfileId, providerReason).catch(() => undefined);
      }
      const failure = mapPiFailure(error, input.mode);
      await writeFile(errorPath, failure.message, { encoding: "utf8", mode: 0o600 });
      return failedResult(input, tracePath, errorPath, failure.code, failure.message, partialText, externalSessionId);
    }
  };
}

function providerFailureReason(error: unknown): SafeProviderReason | null {
  return error instanceof PiHostClientError ? planProviderRuntimeFailureReason(error.code) : null;
}

function resolveNativeSessionPath(mode: LocalExecutionMode): string | null {
  return mode.kind === "resume" ? mode.externalSessionId : null;
}

function normalizePiEffort(value: string): "high" | "max" {
  return value === "max" ? "max" : "high";
}

function piSessionDirectory(dataRoot: string, profileId: string, cwd: string): string {
  const workspace = createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 24);
  const profile = createHash("sha256").update(profileId).digest("hex").slice(0, 24);
  return path.join(dataRoot, ".state", "pi-sessions", profile, workspace);
}

async function appendSafeTrace(tracePath: string, event: PiHostOutputFrame): Promise<void> {
  await appendFile(tracePath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
}

function mapPiFailure(error: unknown, mode: LocalExecutionMode): CodexRunFailure {
  if (error instanceof PiProviderProfileUnavailableError) {
    const code = ({
      disabled: "pi-provider-disabled",
      "needs-attention": "pi-provider-needs-attention",
      missing: "pi-provider-missing",
    } as const)[error.kind];
    return { code, message: error.message };
  }
  if (!(error instanceof PiHostClientError)) {
    return { code: "pi-host-crashed", message: "Pi Host 意外退出。" };
  }
  const code = ({
    auth: "pi-auth-required",
    "model-unavailable": "pi-model-unavailable",
    "model-incompatible": "pi-model-incompatible",
    "rate-limited": "pi-rate-limited",
    quota: "pi-quota-exhausted",
    network: "pi-network-unavailable",
    "provider-unavailable": mode.kind === "resume" ? "pi-resume-unavailable" : "pi-provider-unavailable",
    "no-complete-result": "pi-no-complete-result",
    crashed: "pi-host-crashed",
    cancelled: "pi-cancelled",
  } as const)[error.code];
  return { code, message: error.message };
}

function failedResult(
  input: PiExecutionRunOptions,
  tracePath: string,
  errorPath: string,
  code: CodexRunFailure["code"],
  message: string,
  partialText: string,
  threadId: string | null = null,
): CodexRunResult {
  return {
    ok: false,
    reason: code,
    failure: { code, message },
    threadId,
    runDir: input.runDir,
    stdoutPath: tracePath,
    stderrPath: errorPath,
    terminal: planExecutionFailureTerminal({ code, message }, partialText),
  };
}
