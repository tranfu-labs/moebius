import { spawn } from "node:child_process";

const DEFAULT_CLAUDE_VERSION_TIMEOUT_MS = 5_000;

export async function runClaudeVersion(
  executablePath: string,
  timeoutMs = DEFAULT_CLAUDE_VERSION_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executablePath, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: process.env,
    });
    let stdout = "";
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error === undefined) resolve(stdout.trim());
      else reject(error);
    };
    const abort = (): void => {
      child.kill("SIGKILL");
      finish(new ClaudeVersionError("Claude Code 版本检查已取消。"));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new ClaudeVersionError("Claude Code 版本检查超时。"));
    }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < 4_096) stdout += chunk.toString("utf8");
    });
    child.on("error", () => finish(new ClaudeVersionError("暂时无法检查 Claude Code 版本。")));
    child.on("close", (code) => {
      if (code !== 0 || stdout.trim().length === 0) {
        finish(new ClaudeVersionError("Claude Code 没有返回有效版本。"));
        return;
      }
      finish();
    });
  });
}

export class ClaudeVersionError extends Error {
  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "ClaudeVersionError";
  }
}
