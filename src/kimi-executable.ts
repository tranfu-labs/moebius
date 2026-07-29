import fs from "node:fs/promises";
import { resolveCliExecutable } from "./cli-executable.js";

export type KimiExecutableFailureCode =
  | "kimi-cli-not-found"
  | "kimi-cli-not-executable";

export interface ResolveKimiExecutableOptions {
  pathValue: string | undefined;
  cwd: string;
  homeDir: string;
  stat?: typeof fs.stat;
  access?: typeof fs.access;
}

export async function resolveKimiExecutable(
  options: ResolveKimiExecutableOptions,
): Promise<string> {
  return resolveCliExecutable({
    executableName: "kimi",
    defaultRelativePath: [".kimi-code", "bin", "kimi"],
    pathValue: options.pathValue,
    cwd: options.cwd,
    homeDir: options.homeDir,
    stat: options.stat,
    access: options.access,
    notFound: () => new KimiExecutableError(
      "kimi-cli-not-found",
      "没有找到 Kimi CLI。请先安装 Kimi，然后重试。",
    ),
    notExecutable: () => new KimiExecutableError(
      "kimi-cli-not-executable",
      "找到 Kimi CLI，但它不可执行。请修复文件执行权限后重试。",
    ),
  });
}

export class KimiExecutableError extends Error {
  constructor(
    readonly code: KimiExecutableFailureCode,
    readonly safeMessage: string,
  ) {
    super(safeMessage);
    this.name = "KimiExecutableError";
  }
}
