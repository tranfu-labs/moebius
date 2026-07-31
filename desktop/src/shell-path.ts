import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: readonly string[]) => Promise<CommandResult>;

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
}): Promise<ShellPathResult> {
  const currentPath = input.currentPath ?? "";
  if (input.platform !== "darwin") {
    return { path: currentPath, source: "unchanged" };
  }

  const shellPath = input.shellPath?.trim() || process.env.SHELL || os.userInfo().shell || "/bin/zsh";
  try {
    const result = await (input.runCommand ?? runCommand)(shellPath, ["-l", "-c", "printf %s \"$PATH\""]);
    if (result.exitCode !== 0 || result.stdout.trim() === "") {
      return {
        path: currentPath,
        source: "fallback",
        error: result.stderr.trim() || `login shell exited with ${result.exitCode}`,
      };
    }

    return {
      path: mergePathValues(currentPath, result.stdout.trim()),
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

export function runCommand(command: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
