import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringify } from "yaml";

import {
  expectedReleaseAssets,
  normalizeVersion,
  sha512Base64,
  validateUpdateMetadataDirectory,
  type UpdateMetadataValidationResult,
} from "./validate-update-metadata.js";

export async function prepareReleaseAssets(
  inputDirectory: string,
  outputDirectory: string,
  versionInput: string,
  releaseDate = new Date().toISOString(),
): Promise<UpdateMetadataValidationResult> {
  const version = normalizeVersion(versionInput);
  const expected = expectedReleaseAssets(version);
  await mkdir(outputDirectory, { recursive: true });
  const existing = await readdir(outputDirectory);
  if (existing.length > 0) throw new Error(`release staging directory must be empty: ${outputDirectory}`);

  await copyFile(path.join(inputDirectory, expected.dmgName), path.join(outputDirectory, expected.dmgName));
  await copyFile(path.join(inputDirectory, expected.zipName), path.join(outputDirectory, expected.zipName));
  const blockmapPath = path.join(inputDirectory, expected.blockmapName);
  let blockMapSize: number | undefined;
  try {
    blockMapSize = (await stat(blockmapPath)).size;
    await copyFile(blockmapPath, path.join(outputDirectory, expected.blockmapName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    blockMapSize = undefined;
  }

  const zipPath = path.join(outputDirectory, expected.zipName);
  const zipSize = (await stat(zipPath)).size;
  const zipSha512 = await sha512Base64(zipPath);
  await writeFile(
    path.join(outputDirectory, expected.metadataName),
    stringify({
      version,
      files: [{
        url: expected.zipName,
        sha512: zipSha512,
        size: zipSize,
        ...(blockMapSize === undefined ? {} : { blockMapSize }),
      }],
      path: expected.zipName,
      sha512: zipSha512,
      size: zipSize,
      releaseDate,
    }),
    "utf8",
  );
  return validateUpdateMetadataDirectory(outputDirectory, version);
}

function parseArgs(argv: string[]): { input: string; output: string; version: string } {
  const result: Partial<{ input: string; output: string; version: string }> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--input", "--output", "--version"].includes(flag) || value === undefined) {
      throw new Error("usage: --input <builder-output> --output <release-staging-dir> --version <version>");
    }
    index += 1;
    if (flag === "--input") result.input = value;
    else if (flag === "--output") result.output = value;
    else result.version = value;
  }
  if (result.input === undefined || result.output === undefined || result.version === undefined) {
    throw new Error("usage: --input <builder-output> --output <release-staging-dir> --version <version>");
  }
  return result as { input: string; output: string; version: string };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  prepareReleaseAssets(args.input, args.output, args.version)
    .then((result) => process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
