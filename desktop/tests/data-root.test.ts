import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSeedCopyPlan,
  resolveDesktopDataRoot,
  resolveDesktopInstanceUserDataPath,
  type SeedPlanFileSystem,
} from "../src/data-root.js";

const LEGACY_DATA_ROOT_ENV = ["AGENT", "MOEBIUS", "DATA", "ROOT"].join("_");

describe("desktop data root", () => {
  it("uses the environment override first", () => {
    expect(
      resolveDesktopDataRoot({
        env: { MOEBIUS_DATA_ROOT: "/tmp/custom-moebius" },
        isPackaged: true,
        projectRoot: "/repo",
        homeDir: "/home/alice",
      }),
    ).toBe("/tmp/custom-moebius");
  });

  it("uses ~/.moebius when packaged and project root during development", () => {
    expect(resolveDesktopDataRoot({ env: {}, isPackaged: true, projectRoot: "/repo", homeDir: "/home/alice" })).toBe(
      "/home/alice/.moebius",
    );
    expect(resolveDesktopDataRoot({ env: {}, isPackaged: false, projectRoot: "/repo", homeDir: "/home/alice" })).toBe(
      "/repo",
    );
  });

  it("does not read the legacy data root environment variable", () => {
    expect(
      resolveDesktopDataRoot({
        env: { [LEGACY_DATA_ROOT_ENV]: "/tmp/legacy-data" },
        isPackaged: true,
        projectRoot: "/repo",
        homeDir: "/home/alice",
      }),
    ).toBe("/home/alice/.moebius");
  });

  it("keeps the existing Electron userData path for the packaged default data root", () => {
    expect(
      resolveDesktopInstanceUserDataPath({
        dataRoot: "/home/alice/.moebius",
        packagedDefaultDataRoot: "/home/alice/.moebius",
        defaultUserDataPath: "/home/alice/Library/Application Support/@moebius/desktop",
      }),
    ).toBe("/home/alice/Library/Application Support/@moebius/desktop");
  });

  it("derives a stable isolated Electron userData path for every other normalized data root", () => {
    expect(
      resolveDesktopInstanceUserDataPath({
        dataRoot: "/repo/worktree/../worktree",
        packagedDefaultDataRoot: "/home/alice/.moebius",
        defaultUserDataPath: "/home/alice/Library/Application Support/@moebius/desktop",
      }),
    ).toBe("/repo/worktree/.state/desktop-user-data");
    expect(
      resolveDesktopInstanceUserDataPath({
        dataRoot: "/repo/other",
        packagedDefaultDataRoot: "/home/alice/.moebius",
        defaultUserDataPath: "/home/alice/Library/Application Support/@moebius/desktop",
      }),
    ).toBe("/repo/other/.state/desktop-user-data");
  });

  it("maps an explicit shared data root to the same instance scope across run shapes", () => {
    const env = { MOEBIUS_DATA_ROOT: "/tmp/shared-moebius/../shared-moebius" };
    const packagedDataRoot = resolveDesktopDataRoot({
      env,
      isPackaged: true,
      projectRoot: "/Applications/Moebius.app",
      homeDir: "/home/alice",
    });
    const developmentDataRoot = resolveDesktopDataRoot({
      env,
      isPackaged: false,
      projectRoot: "/repo",
      homeDir: "/home/alice",
    });
    const resolveInstancePath = (resolvedDataRoot: string) =>
      resolveDesktopInstanceUserDataPath({
        dataRoot: resolvedDataRoot,
        packagedDefaultDataRoot: "/home/alice/.moebius",
        defaultUserDataPath: "/home/alice/Library/Application Support/@moebius/desktop",
      });

    expect(packagedDataRoot).toBe(developmentDataRoot);
    expect(resolveInstancePath(packagedDataRoot)).toBe(resolveInstancePath(developmentDataRoot));
  });

  it("separates the packaged and development default instance scopes", () => {
    const packagedDataRoot = resolveDesktopDataRoot({
      env: {},
      isPackaged: true,
      projectRoot: "/Applications/Moebius.app",
      homeDir: "/home/alice",
    });
    const developmentDataRoot = resolveDesktopDataRoot({
      env: {},
      isPackaged: false,
      projectRoot: "/repo",
      homeDir: "/home/alice",
    });
    const defaultUserDataPath = "/home/alice/Library/Application Support/@moebius/desktop";

    expect(
      resolveDesktopInstanceUserDataPath({
        dataRoot: packagedDataRoot,
        packagedDefaultDataRoot: packagedDataRoot,
        defaultUserDataPath,
      }),
    ).toBe(defaultUserDataPath);
    expect(
      resolveDesktopInstanceUserDataPath({
        dataRoot: developmentDataRoot,
        packagedDefaultDataRoot: packagedDataRoot,
        defaultUserDataPath,
      }),
    ).toBe("/repo/.state/desktop-user-data");
  });

  it("plans config and agents seed copies without overwriting existing destinations", async () => {
    const seedRoot = "/app/seed";
    const dataRoot = "/home/alice/.moebius";
    const existing = new Set([path.join(dataRoot, "agents", "dev.md")]);
    const fileSystem: SeedPlanFileSystem = {
      async exists(filePath) {
        return existing.has(filePath);
      },
      async listFiles(root) {
        expect(root).toBe(path.join(seedRoot, "agents"));
        return [
          path.join(seedRoot, "agents", "ceo-scripts", "goal-intake.md"),
          path.join(seedRoot, "agents", "dev.md"),
        ];
      },
    };

    const plan = await buildSeedCopyPlan({ seedRoot, dataRoot, fileSystem });

    expect(plan.skippedDestinations).toEqual([path.join(dataRoot, "agents", "dev.md")]);
    expect(plan.operations).toEqual([
      { source: path.join(seedRoot, "config.toml"), destination: path.join(dataRoot, "config.toml") },
      {
        source: path.join(seedRoot, "agents", "ceo-scripts", "goal-intake.md"),
        destination: path.join(dataRoot, "agents", "ceo-scripts", "goal-intake.md"),
      },
    ]);
  });
});
