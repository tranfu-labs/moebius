import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse as parseToml } from "smol-toml";
import { afterEach, describe, expect, it } from "vitest";

import {
  KimiRuntimeIsolationError,
  prepareKimiRuntimeHome,
  resolveKimiRuntimeHomePaths,
  withManagedKimiHome,
} from "../src/kimi-runtime-home.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{ root: string; sourceHome: string; managedHome: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-kimi-home-"));
  temporaryRoots.push(root);
  const sourceHome = path.join(root, "source");
  const managedHome = path.join(root, "managed");
  await fs.mkdir(sourceHome, { recursive: true });
  return { root, sourceHome, managedHome };
}

describe("Kimi managed runtime home", () => {
  it("resolves the user home separately from the Moebius-managed home", () => {
    expect(resolveKimiRuntimeHomePaths({
      dataRoot: "/tmp/moebius-data",
      env: { KIMI_CODE_HOME: "/tmp/custom-kimi" },
      homeDir: "/tmp/ignored-home",
    })).toEqual({
      sourceHome: "/tmp/custom-kimi",
      managedHome: "/tmp/moebius-data/.state/kimi-runtime-home",
    });

    const original = { PATH: "/usr/bin", KIMI_CODE_HOME: "/tmp/user-kimi" };
    expect(withManagedKimiHome(original, "/tmp/managed-kimi")).toEqual({
      PATH: "/usr/bin",
      KIMI_CODE_HOME: "/tmp/managed-kimi",
    });
    expect(original.KIMI_CODE_HOME).toBe("/tmp/user-kimi");
  });

  it("preserves user settings while disabling both Kimi delegation tools", async () => {
    const { sourceHome, managedHome } = await fixture();
    await fs.writeFile(
      path.join(sourceHome, "config.toml"),
      [
        'default_model = "kimi-for-coding"',
        "[tools]",
        'disabled = ["Bash"]',
        "",
      ].join("\n"),
    );

    await prepareKimiRuntimeHome({ sourceHome, managedHome });

    const managedConfigPath = path.join(managedHome, "config.toml");
    const managedConfig = parseToml(await fs.readFile(managedConfigPath, "utf8"));
    expect(managedConfig).toMatchObject({
      default_model: "kimi-for-coding",
      tools: {
        disabled: ["Bash", "Agent", "AgentSwarm"],
      },
    });
    expect((await fs.stat(managedConfigPath)).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(path.join(sourceHome, "config.toml"), "utf8"))
      .toContain('disabled = ["Bash"]');
  });

  it("shares authentication and session state without sharing the user config", async () => {
    const { sourceHome, managedHome } = await fixture();
    await fs.writeFile(path.join(sourceHome, "config.toml"), "");
    await Promise.all([
      fs.mkdir(path.join(sourceHome, "credentials")),
      fs.mkdir(path.join(sourceHome, "oauth")),
      fs.mkdir(path.join(sourceHome, "sessions")),
      fs.writeFile(path.join(sourceHome, "device_id"), "device"),
      fs.writeFile(path.join(sourceHome, "session_index.jsonl"), ""),
      fs.writeFile(path.join(sourceHome, "workspaces.json"), "{}"),
    ]);

    await prepareKimiRuntimeHome({ sourceHome, managedHome });

    for (const entry of [
      "credentials",
      "oauth",
      "device_id",
      "sessions",
      "session_index.jsonl",
      "workspaces.json",
    ]) {
      const targetPath = path.join(managedHome, entry);
      expect((await fs.lstat(targetPath)).isSymbolicLink()).toBe(true);
      expect(path.resolve(managedHome, await fs.readlink(targetPath)))
        .toBe(path.join(sourceHome, entry));
    }
    expect((await fs.lstat(path.join(managedHome, "config.toml"))).isSymbolicLink()).toBe(false);
  });

  it("is idempotent and does not duplicate disabled tools", async () => {
    const { sourceHome, managedHome } = await fixture();
    await fs.writeFile(
      path.join(sourceHome, "config.toml"),
      '[tools]\ndisabled = ["Agent", "AgentSwarm"]\n',
    );

    await prepareKimiRuntimeHome({ sourceHome, managedHome });
    await prepareKimiRuntimeHome({ sourceHome, managedHome });

    const managedConfig = parseToml(
      await fs.readFile(path.join(managedHome, "config.toml"), "utf8"),
    ) as { tools: { disabled: string[] } };
    expect(managedConfig.tools.disabled).toEqual(["Agent", "AgentSwarm"]);
  });

  it.each([
    {
      name: "malformed config",
      config: "[tools",
    },
    {
      name: "invalid disabled list",
      config: '[tools]\ndisabled = "Agent"\n',
    },
  ])("fails closed for $name", async ({ config }) => {
    const { sourceHome, managedHome } = await fixture();
    await fs.writeFile(path.join(sourceHome, "config.toml"), config);

    await expect(prepareKimiRuntimeHome({ sourceHome, managedHome }))
      .rejects.toBeInstanceOf(KimiRuntimeIsolationError);
  });

  it("creates an isolated default config for a fresh Kimi home", async () => {
    const { sourceHome, managedHome } = await fixture();

    await prepareKimiRuntimeHome({ sourceHome, managedHome });

    expect(parseToml(
      await fs.readFile(path.join(managedHome, "config.toml"), "utf8"),
    )).toMatchObject({
      tools: {
        disabled: ["Agent", "AgentSwarm"],
      },
    });
  });

  it("does not replace an unexpected managed runtime entry", async () => {
    const { sourceHome, managedHome } = await fixture();
    await fs.writeFile(path.join(sourceHome, "config.toml"), "");
    await fs.mkdir(path.join(sourceHome, "sessions"));
    await fs.mkdir(managedHome, { recursive: true });
    await fs.mkdir(path.join(managedHome, "sessions"));

    await expect(prepareKimiRuntimeHome({ sourceHome, managedHome }))
      .rejects.toMatchObject({
        code: "KIMI_RUNTIME_ISOLATION_FAILED",
      });
    expect((await fs.lstat(path.join(sourceHome, "sessions"))).isDirectory()).toBe(true);
    expect((await fs.lstat(path.join(managedHome, "sessions"))).isDirectory()).toBe(true);
  });

  it("rejects a managed home that is itself a symbolic link", async () => {
    const { root, sourceHome, managedHome } = await fixture();
    const unexpectedHome = path.join(root, "unexpected");
    await fs.mkdir(unexpectedHome);
    await fs.symlink(unexpectedHome, managedHome);

    await expect(prepareKimiRuntimeHome({ sourceHome, managedHome }))
      .rejects.toMatchObject({
        code: "KIMI_RUNTIME_ISOLATION_FAILED",
      });
    expect(await fs.readdir(unexpectedHome)).toEqual([]);
  });
});
