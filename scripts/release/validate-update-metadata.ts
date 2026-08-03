import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, rm, stat, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { parse } from "yaml";

const PRODUCT_NAME = "Moebius";
const REPOSITORY = "tranfu-labs/moebius";

export interface UpdateMetadataValidationResult {
  version: string;
  zipName: string;
  zipSize: number;
  zipSha512: string;
  assets: string[];
  blockmapName?: string;
  blockmapSize?: number;
}

interface LatestMacFile {
  url?: unknown;
  sha512?: unknown;
  size?: unknown;
  blockMapSize?: unknown;
}

interface LatestMacMetadata {
  version?: unknown;
  path?: unknown;
  sha512?: unknown;
  size?: unknown;
  files?: unknown;
}

export function normalizeVersion(raw: string): string {
  const version = raw.trim().replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid release version: ${raw}`);
  }
  return version;
}

export function expectedReleaseAssets(versionInput: string): {
  dmgName: string;
  zipName: string;
  metadataName: string;
  blockmapName: string;
} {
  const version = normalizeVersion(versionInput);
  const stem = `${PRODUCT_NAME}-${version}-mac-arm64`;
  return {
    dmgName: `${stem}.dmg`,
    zipName: `${stem}.zip`,
    metadataName: "latest-mac.yml",
    blockmapName: `${stem}.zip.blockmap`,
  };
}

export async function validateUpdateMetadataDirectory(
  directory: string,
  versionInput: string,
): Promise<UpdateMetadataValidationResult> {
  const version = normalizeVersion(versionInput);
  const expected = expectedReleaseAssets(version);
  const entries = await readdir(directory, { withFileTypes: true });
  const nonFiles = entries.filter((entry) => !entry.isFile()).map((entry) => entry.name).sort();
  if (nonFiles.length > 0) throw new Error(`release directory contains non-whitelisted entries: ${nonFiles.join(", ")}`);
  const assets = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  const unexpected = assets.filter((name) => ![expected.dmgName, expected.zipName, expected.metadataName, expected.blockmapName].includes(name));
  if (unexpected.length > 0) {
    throw new Error(`release directory contains non-whitelisted assets: ${unexpected.join(", ")}`);
  }
  for (const required of [expected.dmgName, expected.zipName, expected.metadataName]) {
    if (!assets.includes(required)) throw new Error(`release directory is missing ${required}`);
  }

  const metadata = parse(await readFile(path.join(directory, expected.metadataName), "utf8")) as LatestMacMetadata;
  if (metadata.version !== version) {
    throw new Error(`latest-mac.yml version ${String(metadata.version)} does not match ${version}`);
  }
  const files = Array.isArray(metadata.files) ? metadata.files : [];
  if (files.length !== 1 || files[0] === null || typeof files[0] !== "object") {
    throw new Error("latest-mac.yml must describe exactly one macOS arm64 update file");
  }
  const file = files[0] as LatestMacFile;
  const metadataFileName = assetNameFromUrl(file.url);
  if (metadataFileName !== expected.zipName) {
    throw new Error(`latest-mac.yml file ${metadataFileName ?? "<missing>"} does not match ${expected.zipName}`);
  }

  const zipPath = path.join(directory, expected.zipName);
  const zipStats = await stat(zipPath);
  const zipSha512 = await sha512Base64(zipPath);
  assertOptionalMatch("latest-mac.yml size", metadata.size, zipStats.size);
  assertOptionalMatch("latest-mac.yml sha512", metadata.sha512, zipSha512);
  assertMatch("latest-mac.yml files[0].size", file.size, zipStats.size);
  assertMatch("latest-mac.yml files[0].sha512", file.sha512, zipSha512);
  if (metadata.path !== undefined && assetNameFromUrl(metadata.path) !== expected.zipName) {
    throw new Error(`latest-mac.yml path does not match ${expected.zipName}`);
  }

  const blockMapSize = file.blockMapSize;
  const blockmapPresent = assets.includes(expected.blockmapName);
  if (blockMapSize !== undefined) {
    assertMatch("latest-mac.yml files[0].blockMapSize", blockMapSize, await fileSize(directory, expected.blockmapName));
    if (!blockmapPresent) throw new Error(`latest-mac.yml references missing ${expected.blockmapName}`);
  } else if (blockmapPresent) {
    throw new Error(`${expected.blockmapName} is not referenced by latest-mac.yml`);
  }

  return {
    version,
    zipName: expected.zipName,
    zipSize: zipStats.size,
    zipSha512,
    assets,
    ...(blockmapPresent ? { blockmapName: expected.blockmapName, blockmapSize: await fileSize(directory, expected.blockmapName) } : {}),
  };
}

function assetNameFromUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    const url = new URL(value, "https://release.invalid/");
    return path.posix.basename(url.pathname);
  } catch {
    return undefined;
  }
}

function assertMatch(label: string, actual: unknown, expected: number | string): void {
  if (actual !== expected) throw new Error(`${label} ${String(actual)} does not match ${String(expected)}`);
}

function assertOptionalMatch(label: string, actual: unknown, expected: number | string): void {
  if (actual !== undefined) assertMatch(label, actual, expected);
}

async function fileSize(directory: string, name: string): Promise<number> {
  try {
    return (await stat(path.join(directory, name))).size;
  } catch {
    throw new Error(`release directory is missing ${name}`);
  }
}

export async function sha512Base64(filePath: string): Promise<string> {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("base64");
}

export async function validateRemoteRelease(
  tagInput: string,
  versionInput = tagInput,
  repository = REPOSITORY,
): Promise<UpdateMetadataValidationResult> {
  const tag = tagInput.startsWith("v") ? tagInput : `v${tagInput}`;
  const version = normalizeVersion(versionInput);
  const expected = expectedReleaseAssets(version);
  const releaseJson = await runGh(["release", "view", tag, "--repo", repository, "--json", "assets"]);
  const release = JSON.parse(releaseJson) as { assets?: Array<{ name?: unknown }> };
  const remoteNames = (release.assets ?? []).map((asset) => asset.name).filter((name): name is string => typeof name === "string").sort();
  const allowed = new Set([expected.dmgName, expected.zipName, expected.metadataName, expected.blockmapName]);
  const unexpected = remoteNames.filter((name) => !allowed.has(name));
  if (unexpected.length > 0) throw new Error(`remote release contains non-whitelisted assets: ${unexpected.join(", ")}`);
  const required = [expected.dmgName, expected.zipName, expected.metadataName];
  for (const name of required) if (!remoteNames.includes(name)) throw new Error(`remote release is missing ${name}`);

  const directory = await mkdtemp(path.join(os.tmpdir(), "moebius-release-verify-"));
  try {
    const args = ["release", "download", tag, "--repo", repository, "--dir", directory];
    for (const name of remoteNames) if (allowed.has(name)) args.push("--pattern", name);
    await runGh(args);
    return await validateUpdateMetadataDirectory(directory, version);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runGh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`gh ${args[0]} failed (${String(code)}): ${stderr.trim()}`));
    });
  });
}

function parseArgs(argv: string[]): { directory?: string; remote?: string; version?: string; repository?: string } {
  const result: { directory?: string; remote?: string; version?: string; repository?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--dir", "--remote", "--version", "--repo"].includes(flag) || value === undefined) {
      throw new Error(`usage: --dir <release-dir> --version <version> | --remote <tag> [--version <version>] [--repo <owner/repo>]`);
    }
    index += 1;
    if (flag === "--dir") result.directory = value;
    else if (flag === "--remote") result.remote = value;
    else if (flag === "--version") result.version = value;
    else result.repository = value;
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if ((args.directory === undefined) === (args.remote === undefined)) {
    throw new Error("choose exactly one of --dir or --remote");
  }
  const result = args.directory !== undefined
    ? await validateUpdateMetadataDirectory(args.directory, args.version ?? (() => { throw new Error("--dir requires --version"); })())
    : await validateRemoteRelease(args.remote!, args.version, args.repository);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
