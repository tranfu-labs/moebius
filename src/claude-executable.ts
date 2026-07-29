import fs from "node:fs/promises";
import { resolveCliExecutable } from "./cli-executable.js";

export type ClaudeExecutableFailureCode =
  | "claude-cli-not-found"
  | "claude-cli-not-executable";

export interface ResolveClaudeExecutableOptions {
  pathValue: string | undefined;
  cwd: string;
  homeDir: string;
  stat?: typeof fs.stat;
  access?: typeof fs.access;
}

export function resolveClaudeExecutable(
  options: ResolveClaudeExecutableOptions,
): Promise<string> {
  return resolveCliExecutable({
    executableName: "claude",
    defaultRelativePath: [".local", "bin", "claude"],
    pathValue: options.pathValue,
    cwd: options.cwd,
    homeDir: options.homeDir,
    stat: options.stat,
    access: options.access,
    notFound: () => new ClaudeExecutableError(
      "claude-cli-not-found",
      "没有找到 Claude Code。请先安装 Claude Code，然后重试。",
    ),
    notExecutable: () => new ClaudeExecutableError(
      "claude-cli-not-executable",
      "找到 Claude Code，但它不可执行。请修复文件执行权限后重试。",
    ),
  });
}

export class ClaudeExecutableError extends Error {
  constructor(
    readonly code: ClaudeExecutableFailureCode,
    readonly safeMessage: string,
  ) {
    super(safeMessage);
    this.name = "ClaudeExecutableError";
  }
}
