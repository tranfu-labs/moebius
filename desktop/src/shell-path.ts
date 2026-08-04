import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  DESKTOP_SHELL_PATH_MAX_OUTPUT_BYTES,
  DESKTOP_SHELL_PATH_TERMINATE_GRACE_MS,
  DESKTOP_SHELL_PATH_TIMEOUT_MS,
} from "../../src/config.js";

const SHELL_PATH_FRAME_BEGIN = "__MOEBIUS_SHELL_PATH_BEGIN__";
const SHELL_PATH_FRAME_END = "__MOEBIUS_SHELL_PATH_END__";
const SHELL_PATH_PRINT_COMMAND =
  `printf '%s\\n' '${SHELL_PATH_FRAME_BEGIN}' "$PATH" '${SHELL_PATH_FRAME_END}'`;

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  terminateGraceMs?: number;
  argv0?: string;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

export interface ShellPathResult {
  path: string;
  source: "unchanged" | "login-shell" | "fallback";
  error?: string;
}

export interface ShellPathReadinessGate {
  readonly ready: Promise<void>;
  start(): void;
  afterReady<T>(operation: () => Promise<T>): Promise<T>;
}

export function createShellPathReadinessGate(input: {
  resolve: () => Promise<ShellPathResult>;
  apply: (result: ShellPathResult) => void;
}): ShellPathReadinessGate {
  let started = false;
  let settle: (() => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const ready = new Promise<void>((resolve, rejectPromise) => {
    settle = resolve;
    reject = rejectPromise;
  });

  return {
    ready,
    start() {
      if (started) {
        return;
      }
      started = true;
      void Promise.resolve()
        .then(input.resolve)
        .then((result) => {
          input.apply(result);
          settle?.();
        })
        .catch((error: unknown) => {
          reject?.(error);
        });
    },
    async afterReady<T>(operation: () => Promise<T>): Promise<T> {
      await ready;
      return operation();
    },
  };
}

export async function resolveShellPath(input: {
  platform: NodeJS.Platform;
  currentPath: string | undefined;
  shellPath?: string;
  runCommand?: CommandRunner;
  timeoutMs?: number;
  maxOutputBytes?: number;
  terminateGraceMs?: number;
}): Promise<ShellPathResult> {
  const currentPath = input.currentPath ?? "";
  if (input.platform !== "darwin") {
    return { path: currentPath, source: "unchanged" };
  }

  const shellPath = input.shellPath?.trim() || process.env.SHELL || os.userInfo().shell || "/bin/zsh";
  const invocation = shellPathInvocation(shellPath);
  try {
    const result = await (input.runCommand ?? runCommand)(
      shellPath,
      invocation.args,
      {
        timeoutMs: input.timeoutMs ?? DESKTOP_SHELL_PATH_TIMEOUT_MS,
        maxOutputBytes: input.maxOutputBytes ?? DESKTOP_SHELL_PATH_MAX_OUTPUT_BYTES,
        terminateGraceMs:
          input.terminateGraceMs ?? DESKTOP_SHELL_PATH_TERMINATE_GRACE_MS,
        argv0: invocation.argv0,
      },
    );
    if (result.exitCode !== 0) {
      return {
        path: currentPath,
        source: "fallback",
        error: `login-shell-exit-${String(result.exitCode)}`,
      };
    }
    const framedPath = extractFramedShellPath(result.stdout);
    if (framedPath.kind !== "valid") {
      return {
        path: currentPath,
        source: "fallback",
        error: framedPath.kind === "empty"
          ? "login-shell-path-empty"
          : "login-shell-path-invalid",
      };
    }

    return {
      path: mergePathValues(currentPath, framedPath.value),
      source: "login-shell",
    };
  } catch (error) {
    return { path: currentPath, source: "fallback", error: formatError(error) };
  }
}

export function mergePathValues(currentPath: string, loginPath: string): string {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const value of [...currentPath.split(path.delimiter), ...loginPath.split(path.delimiter)]) {
    const trimmed = value.trim();
    if (trimmed === "" || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    entries.push(trimmed);
  }
  return entries.join(path.delimiter);
}

export function runCommand(
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs;
    const maxOutputBytes = options.maxOutputBytes;
    const terminateGraceMs = options.terminateGraceMs ?? DESKTOP_SHELL_PATH_TERMINATE_GRACE_MS;
    const detached = process.platform !== "win32"
      && (timeoutMs !== undefined || maxOutputBytes !== undefined);
    const child = spawn(command, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      detached,
      argv0: options.argv0,
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let leaderClosed = false;
    let terminalError: ShellCommandError | null = null;
    let terminateTimer: NodeJS.Timeout | null = null;
    let cleanupDeadlineTimer: NodeJS.Timeout | null = null;
    let cleanupPollTimer: NodeJS.Timeout | null = null;
    const timeout = timeoutMs === undefined
      ? null
      : setTimeout(() => terminate("shell-command-timed-out"), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += boundedChunk(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += boundedChunk(chunk);
    });
    child.on("error", (error) => {
      if (terminalError === null) finish(error);
    });
    child.on("close", (exitCode) => {
      leaderClosed = true;
      if (terminalError !== null) return;
      finish(undefined, { exitCode: exitCode ?? 1, stdout, stderr });
    });

    function boundedChunk(chunk: string): string {
      if (maxOutputBytes === undefined) {
        return chunk;
      }
      const remaining = Math.max(0, maxOutputBytes - outputBytes);
      const chunkBuffer = Buffer.from(chunk, "utf8");
      outputBytes += chunkBuffer.length;
      if (chunkBuffer.length > remaining || outputBytes > maxOutputBytes) {
        terminate("shell-command-output-limit");
      }
      return remaining === 0 ? "" : chunkBuffer.subarray(0, remaining).toString("utf8");
    }

    function terminate(code: ShellCommandErrorCode): void {
      if (terminalError !== null || settled) return;
      terminalError = new ShellCommandError(code);
      signalProcessTree(child.pid, "SIGTERM", detached, child.kill.bind(child));
      terminateTimer = setTimeout(() => escalateTermination(code), terminateGraceMs);
    }

    function escalateTermination(code: ShellCommandErrorCode): void {
      const error = terminalError ?? new ShellCommandError(code);
      signalProcessTree(child.pid, "SIGKILL", detached, child.kill.bind(child));
      if (!detached || child.pid === undefined) {
        if (leaderClosed) finish(error);
        else cleanupDeadlineTimer = setTimeout(() => finish(error), terminateGraceMs);
        return;
      }

      const processGroupId = child.pid;
      if (!processGroupExists(processGroupId)) {
        finish(error);
        return;
      }
      cleanupPollTimer = setInterval(() => {
        if (!processGroupExists(processGroupId)) finish(error);
      }, Math.min(25, Math.max(1, terminateGraceMs)));
      cleanupDeadlineTimer = setTimeout(() => finish(error), terminateGraceMs);
    }

    function finish(error?: Error, result?: CommandResult): void {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      if (terminateTimer !== null) clearTimeout(terminateTimer);
      if (cleanupDeadlineTimer !== null) clearTimeout(cleanupDeadlineTimer);
      if (cleanupPollTimer !== null) clearInterval(cleanupPollTimer);
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.removeAllListeners();
      if (error !== undefined) reject(error);
      else resolve(result!);
    }
  });
}

function shellPathInvocation(shellPath: string): {
  args: readonly string[];
  argv0?: string;
} {
  const shellName = path.basename(shellPath).toLowerCase();
  if (shellName === "csh" || shellName === "tcsh") {
    return {
      args: ["-c", SHELL_PATH_PRINT_COMMAND],
      argv0: `-${shellName}`,
    };
  }
  return { args: ["-ilc", SHELL_PATH_PRINT_COMMAND] };
}

function processGroupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

type ShellCommandErrorCode = "shell-command-timed-out" | "shell-command-output-limit";

class ShellCommandError extends Error {
  constructor(readonly code: ShellCommandErrorCode) {
    super(code);
    this.name = "ShellCommandError";
  }
}

function extractFramedShellPath(stdout: string):
  | { kind: "valid"; value: string }
  | { kind: "empty" | "invalid" } {
  const begin = `${SHELL_PATH_FRAME_BEGIN}\n`;
  const end = `\n${SHELL_PATH_FRAME_END}`;
  const beginIndex = stdout.indexOf(begin);
  if (beginIndex < 0 || beginIndex !== stdout.lastIndexOf(begin)) return { kind: "invalid" };
  const valueStart = beginIndex + begin.length;
  const endIndex = stdout.indexOf(end, valueStart);
  if (endIndex < 0 || endIndex !== stdout.lastIndexOf(end)) return { kind: "invalid" };
  const value = stdout.slice(valueStart, endIndex).trim();
  return value.length === 0 ? { kind: "empty" } : { kind: "valid", value };
}

function signalProcessTree(
  pid: number | undefined,
  signal: NodeJS.Signals,
  detached: boolean,
  killChild: (signal?: NodeJS.Signals | number) => boolean,
): void {
  if (pid !== undefined && detached) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // The process group may have closed between the timeout and signal.
    }
  }
  try {
    killChild(signal);
  } catch {
    // The direct child may already have exited.
  }
}

function formatError(error: unknown): string {
  if (error instanceof ShellCommandError) return error.code;
  return "login-shell-probe-failed";
}
