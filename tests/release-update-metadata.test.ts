import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse, stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import {
  expectedReleaseAssets,
  validateUpdateMetadataDirectory,
} from "../scripts/release/validate-update-metadata.js";
import { buildReleaseUploadArgs } from "../scripts/release/upload-assets.js";
import { prepareReleaseAssets } from "../scripts/release/prepare-update-metadata.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("release update metadata validation", () => {
  it("accepts the final arm64 assets and validates latest-mac.yml against the ZIP", async () => {
    const directory = await makeReleaseDirectory("0.2.1");
    const result = await validateUpdateMetadataDirectory(directory, "0.2.1");

    expect(result.assets).toEqual([
      "Moebius-0.2.1-mac-arm64.dmg",
      "Moebius-0.2.1-mac-arm64.zip",
      "Moebius-0.2.1-mac-arm64.zip.blockmap",
      "latest-mac.yml",
    ]);
    expect(result.zipSha512).toBe(expectedZipDigest());
    expect(result.blockmapSize).toBe(8);
  });

  it("rejects an intermediate artifact instead of allowing it into the upload set", async () => {
    const directory = await makeReleaseDirectory("0.2.1");
    await writeFile(path.join(directory, "builder-effective-config.yaml"), "intermediate\n");

    await expect(validateUpdateMetadataDirectory(directory, "0.2.1")).rejects.toThrow("non-whitelisted");
  });

  it("rejects metadata whose hash no longer describes the final ZIP", async () => {
    const directory = await makeReleaseDirectory("0.2.1");
    const metadataPath = path.join(directory, "latest-mac.yml");
    const metadata = parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
    metadata.sha512 = "not-the-zip";
    await writeFile(metadataPath, stringify(metadata), "utf8");

    await expect(validateUpdateMetadataDirectory(directory, "0.2.1")).rejects.toThrow("sha512");
  });

  it("builds an exact upload argument list and only enables replacement explicitly", () => {
    const args = buildReleaseUploadArgs(
      { tag: "v0.2.1", directory: "/tmp/release", version: "0.2.1" },
      ["Moebius-0.2.1-mac-arm64.dmg", "Moebius-0.2.1-mac-arm64.zip", "latest-mac.yml"],
    );
    expect(args).toEqual([
      "release",
      "upload",
      "v0.2.1",
      "/tmp/release/Moebius-0.2.1-mac-arm64.dmg",
      "/tmp/release/Moebius-0.2.1-mac-arm64.zip",
      "/tmp/release/latest-mac.yml",
      "--repo",
      "tranfu-labs/moebius",
    ]);
    expect(buildReleaseUploadArgs({ tag: "v0.2.1", directory: "/tmp/release", version: "0.2.1", replace: true }, [])).toContain("--clobber");
  });

  it("creates a clean staging directory without copying the DMG blockmap", async () => {
    const input = await makeReleaseDirectory("0.2.1");
    await writeFile(path.join(input, "Moebius-0.2.1-mac-arm64.dmg.blockmap"), "dmg intermediate");
    const output = await mkdtemp(path.join(os.tmpdir(), "moebius-release-staging-test-"));
    temporaryDirectories.push(output);

    const result = await prepareReleaseAssets(input, output, "0.2.1", "2026-08-02T00:00:00.000Z");
    expect(result.assets).not.toContain("Moebius-0.2.1-mac-arm64.dmg.blockmap");
    expect(result.assets).toContain("latest-mac.yml");
  });
});

async function makeReleaseDirectory(version: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "moebius-release-test-"));
  temporaryDirectories.push(directory);
  const expected = expectedReleaseAssets(version);
  const zip = Buffer.from("final signed notarized zip");
  await writeFile(path.join(directory, expected.dmgName), "final dmg");
  await writeFile(path.join(directory, expected.zipName), zip);
  await writeFile(path.join(directory, expected.blockmapName), "blockmap");
  await writeFile(
    path.join(directory, expected.metadataName),
    stringify({
      version,
      path: expected.zipName,
      sha512: createHash("sha512").update(zip).digest("base64"),
      size: zip.length,
      files: [{ url: expected.zipName, sha512: createHash("sha512").update(zip).digest("base64"), size: zip.length, blockMapSize: 8 }],
    }),
    "utf8",
  );
  return directory;
}

function expectedZipDigest(): string {
  return createHash("sha512").update("final signed notarized zip").digest("base64");
}
