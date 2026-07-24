import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generator = path.join(repoRoot, "scripts/generate-brand-assets.mjs");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((temporaryRoot) =>
    rm(temporaryRoot, { recursive: true, force: true })));
});

describe("brand asset contract", () => {
  it("verifies every committed PNG against the manifest", () => {
    const result = spawnSync(process.execPath, [generator, "--check"], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: false,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Brand assets verified: 7 outputs");
  });

  it("records the required dimensions, byte limits, and matching deployment copies", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(repoRoot, "assets/brand/manifest.json"), "utf8"),
    ) as BrandManifest;

    expect(manifest.source).toMatchObject({
      path: "assets/brand/moebius.png",
      width: 1254,
      height: 1254,
      sha256: "40c17417130d9bf8dd3ea536c57ab8469416b452a25546fbc82db58f8291e3d9",
    });
    expect(manifest.assets.map(({ path: assetPath, width, maxBytes }) => ({
      path: assetPath,
      width,
      maxBytes,
    }))).toEqual([
      { path: "assets/brand/generated/app-icon-1024.png", width: 1024, maxBytes: 1_048_576 },
      { path: "assets/brand/generated/ui-icon-64.png", width: 64, maxBytes: 32_768 },
      { path: "assets/brand/generated/favicon-32.png", width: 32, maxBytes: 16_384 },
      { path: "assets/brand/generated/apple-touch-icon-180.png", width: 180, maxBytes: 131_072 },
      { path: "sites/marketeam/assets/moebius-icon-64.png", width: 64, maxBytes: 32_768 },
      { path: "sites/marketeam/assets/favicon-32.png", width: 32, maxBytes: 16_384 },
      { path: "sites/marketeam/assets/apple-touch-icon.png", width: 180, maxBytes: 131_072 },
    ]);
    for (const asset of manifest.assets) {
      expect(asset.height).toBe(asset.width);
      expect(asset.bytes).toBeLessThanOrEqual(asset.maxBytes);
      if (asset.duplicateOf !== undefined) {
        expect(asset.sha256).toBe(
          manifest.assets.find((candidate) => candidate.path === asset.duplicateOf)?.sha256,
        );
      }
    }
  });

  it("rejects a manually replaced output", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "moebius-brand-test-"));
    temporaryRoots.push(fixtureRoot);
    const manifest = JSON.parse(
      await readFile(path.join(repoRoot, "assets/brand/manifest.json"), "utf8"),
    ) as BrandManifest;
    const files = [
      "assets/brand/manifest.json",
      manifest.source.path,
      ...manifest.assets.map((asset) => asset.path),
    ];
    for (const relativePath of files) {
      const destination = path.join(fixtureRoot, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(repoRoot, relativePath), destination);
    }

    const replacedPath = path.join(fixtureRoot, "assets/brand/generated/ui-icon-64.png");
    const replaced = await readFile(replacedPath);
    replaced[replaced.length - 1] ^= 1;
    await writeFile(replacedPath, replaced);

    const result = spawnSync(process.execPath, [generator, "--check", "--root", fixtureRoot], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: false,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("manifest sha256");
  });
});

interface BrandManifest {
  source: {
    path: string;
    width: number;
    height: number;
    bytes: number;
    sha256: string;
  };
  assets: Array<{
    path: string;
    width: number;
    height: number;
    maxBytes: number;
    bytes: number;
    sha256: string;
    duplicateOf?: string;
  }>;
}
