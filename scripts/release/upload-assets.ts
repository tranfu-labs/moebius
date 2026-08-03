import { spawn } from "node:child_process";
import path from "node:path";

import {
  validateRemoteRelease,
  validateUpdateMetadataDirectory,
} from "./validate-update-metadata.js";

const DEFAULT_REPOSITORY = "tranfu-labs/moebius";

export interface ReleaseUploadOptions {
  tag: string;
  directory: string;
  version: string;
  repository?: string;
  replace?: boolean;
}

export function buildReleaseUploadArgs(options: ReleaseUploadOptions, assetNames: readonly string[]): string[] {
  const args = ["release", "upload", options.tag, ...assetNames.map((name) => path.join(options.directory, name)), "--repo", options.repository ?? DEFAULT_REPOSITORY];
  if (options.replace === true) args.push("--clobber");
  return args;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const local = await validateUpdateMetadataDirectory(options.directory, options.version);
  await runGh(buildReleaseUploadArgs(options, local.assets));
  const remote = await validateRemoteRelease(options.tag, options.version, options.repository);
  process.stdout.write(`${JSON.stringify({ ok: true, local, remote }, null, 2)}\n`);
}

function parseArgs(argv: string[]): ReleaseUploadOptions {
  const result: Partial<ReleaseUploadOptions> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--replace") {
      result.replace = true;
      continue;
    }
    if (!["--tag", "--dir", "--version", "--repo"].includes(flag) || value === undefined) {
      throw new Error("usage: --tag v<version> --dir <release-dir> --version <version> [--repo <owner/repo>] [--replace]");
    }
    index += 1;
    if (flag === "--tag") result.tag = value;
    else if (flag === "--dir") result.directory = value;
    else if (flag === "--version") result.version = value;
    else result.repository = value;
  }
  if (result.tag === undefined || result.directory === undefined || result.version === undefined) {
    throw new Error("usage: --tag v<version> --dir <release-dir> --version <version> [--repo <owner/repo>] [--replace]");
  }
  return result as ReleaseUploadOptions;
}

function runGh(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, { stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`gh ${args[0]} failed (${String(code)})`));
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
