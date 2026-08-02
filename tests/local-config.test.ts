import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRuntimePaths } from "../src/config.js";
import { DEFAULT_LOCAL_CONFIG, loadLocalConfig, loadMergedLocalConfig, parseLocalConfig } from "../src/local-config.js";

describe("local config", () => {
  it("uses an empty local config when config.local.toml does not exist", async () => {
    const filePath = path.join(await makeTempDir(), "config.local.toml");

    expect(loadLocalConfig(filePath)).toEqual(DEFAULT_LOCAL_CONFIG);
  });

  it("accepts and ignores the retired repository whitelist while preserving provider settings", () => {
    expect(
      parseLocalConfig(`
[[watchRepositories]]
owner = " tranfu-labs "
repo = " tranfu-agents-app "

[codex]
provider = " internal "
model = " gpt-local "
`),
    ).toEqual({ codex: { provider: "internal", model: "gpt-local" } });
  });

  it("treats a pure-comment config as empty", () => {
    expect(parseLocalConfig("# example only\n")).toEqual(DEFAULT_LOCAL_CONFIG);
  });

  it("fails fast when TOML cannot be parsed", () => {
    expect(() => parseLocalConfig('[[watchRepositories]]\nowner = "unterminated')).toThrow(/Invalid local config TOML/);
  });

  it("fails fast when repository entries have invalid shape", () => {
    expect(() =>
      parseLocalConfig(`
[[watchRepositories]]
owner = ""
repo = "moebius"
`),
    ).toThrow(/Invalid local config shape/);
  });

  it("loads provider defaults and lets config.local.toml override them", async () => {
    const dir = await makeTempDir();
    const configPath = path.join(dir, "config.toml");
    const localConfigPath = path.join(dir, "config.local.toml");

    await fs.writeFile(
      configPath,
      `
[codex]
provider = "default-provider"
model = "default-model"
`,
      "utf8",
    );

    expect(loadMergedLocalConfig({ configPath, localConfigPath }))
      .toEqual({ codex: { provider: "default-provider", model: "default-model" } });

    await fs.writeFile(
      localConfigPath,
      `
[codex]
provider = "local-provider"
model = "local-model"
`,
      "utf8",
    );

    expect(loadMergedLocalConfig({ configPath, localConfigPath }))
      .toEqual({ codex: { provider: "local-provider", model: "local-model" } });
  });

  it("resolves runtime config and agents paths from the data root override", () => {
    expect(
      resolveRuntimePaths({
        projectRoot: "/repo/moebius",
        env: { MOEBIUS_DATA_ROOT: "/Users/test/.moebius" },
      }),
    ).toEqual({
      projectRoot: "/repo/moebius",
      dataRoot: "/Users/test/.moebius",
      configPath: "/Users/test/.moebius/config.toml",
      localConfigPath: "/Users/test/.moebius/config.local.toml",
      agentsDir: "/Users/test/.moebius/agents",
      // workdir 跟随数据根覆盖，不落在 projectRoot 旁
      workdirRoot: "/Users/test/.moebius/workdir",
    });
  });

  it("keeps runtime paths on the project root when the data root override is absent", () => {
    expect(resolveRuntimePaths({ projectRoot: "/repo/moebius", env: {} })).toEqual({
      projectRoot: "/repo/moebius",
      dataRoot: "/repo/moebius",
      configPath: "/repo/moebius/config.toml",
      localConfigPath: "/repo/moebius/config.local.toml",
      agentsDir: "/repo/moebius/agents",
      workdirRoot: "/repo/moebius/workdir",
    });
  });
});

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "moebius-local-config-test-"));
}
