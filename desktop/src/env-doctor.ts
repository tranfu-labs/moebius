import {
  isSupportedCodexCliVersion,
  MINIMUM_CODEX_CLI_VERSION,
} from "../../src/codex-cli-version.js";
import type { CommandRunner } from "./shell-path.js";
import { runCommand } from "./shell-path.js";

export type DoctorStatus = "ok" | "error";

export interface DoctorCheck {
  status: DoctorStatus;
  message: string;
  detail?: string;
}

export async function checkCodex(input: {
  runCommand?: CommandRunner;
} = {}): Promise<DoctorCheck> {
  const run = input.runCommand ?? runCommand;
  try {
    const result = await run("codex", ["--version"]);
    if (result.exitCode === 0) {
      const detail = firstLine(result.stdout);
      if (detail !== undefined) {
        if (!isSupportedCodexCliVersion(detail)) {
          return {
            status: "error",
            message: `Codex 需要升级到 ${MINIMUM_CODEX_CLI_VERSION} 或更高版本`,
            detail,
          };
        }
        return { status: "ok", message: "已找到", detail };
      }
    }
    return { status: "error", message: "Codex 不可用" };
  } catch (error) {
    return {
      status: "error",
      message: isMissingCommandError(error) ? "Codex 未找到" : "Codex 不可用",
    };
  }
}

function firstLine(value: string): string | undefined {
  return value.split(/\r?\n/u).map((part) => part.trim()).find((part) => part.length > 0);
}

function isMissingCommandError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}
