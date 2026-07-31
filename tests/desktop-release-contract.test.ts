import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("desktop release contract", () => {
  it("only configures arm64 DMG and ZIP artifacts for macOS", async () => {
    const desktopPackage = JSON.parse(
      await readFile(path.join(repoRoot, "desktop/package.json"), "utf8"),
    ) as DesktopPackage;

    expect(desktopPackage.scripts.dist).toContain("brand:check");
    expect(desktopPackage.scripts.dist).toContain("electron-builder --mac --arm64");
    expect(desktopPackage.build.win).toBeUndefined();
    expect(desktopPackage.build.linux).toBeUndefined();
    expect(desktopPackage.build.mac.icon).toBe("../assets/brand/generated/app-icon-1024.png");
    expect(desktopPackage.build.mac.artifactName).toContain("mac-${arch}");
    expect(desktopPackage.build.mac.target).toEqual([
      { target: "dmg", arch: ["arm64"] },
      { target: "zip", arch: ["arm64"] },
    ]);
    expect(desktopPackage.dependencies["electron-updater"]).toBeDefined();
    expect(desktopPackage.build.publish).toEqual([{
      provider: "github",
      owner: "tranfu-labs",
      repo: "moebius",
    }]);
  });

  it("uses release-moebius as the only publisher and keeps package versions synchronized", async () => {
    await expect(access(path.join(repoRoot, ".github/workflows/release-desktop.yml")))
      .rejects.toMatchObject({ code: "ENOENT" });

    const packagePaths = [
      "package.json",
      "desktop/package.json",
      "packages/console-ui/package.json",
      "prototypes/package.json",
    ];
    const versions = await Promise.all(packagePaths.map(async (packagePath) => {
      const packageJson = JSON.parse(
        await readFile(path.join(repoRoot, packagePath), "utf8"),
      ) as { version: string };
      return packageJson.version;
    }));
    expect(new Set(versions).size).toBe(1);
  });
});

interface DesktopPackage {
  dependencies: Record<string, string>;
  scripts: { dist: string };
  build: {
    mac: {
      icon: string;
      artifactName: string;
      target: Array<{ target: string; arch: string[] }>;
    };
    publish: Array<{ provider: string; owner: string; repo: string }>;
    win?: unknown;
    linux?: unknown;
  };
}
