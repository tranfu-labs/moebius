import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  KimiExecutableError,
  resolveKimiExecutable,
} from "../src/kimi-executable.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

describe("resolveKimiExecutable", () => {
  it("prefers the first PATH executable over later entries and the default location", async () => {
    const root = await makeRoot();
    const firstBin = path.join(root, "first-bin");
    const secondBin = path.join(root, "second-bin");
    const homeDir = path.join(root, "home");
    const first = await executable(path.join(firstBin, "kimi"));
    await executable(path.join(secondBin, "kimi"));
    await executable(path.join(homeDir, ".kimi-code", "bin", "kimi"));

    await expect(resolveKimiExecutable({
      pathValue: [firstBin, secondBin].join(path.delimiter),
      cwd: root,
      homeDir,
    })).resolves.toBe(first);
  });

  it("uses the host default location when PATH has no Kimi candidate", async () => {
    const root = await makeRoot();
    const homeDir = path.join(root, "host-home");
    const expected = await executable(path.join(homeDir, ".kimi-code", "bin", "kimi"));

    await expect(resolveKimiExecutable({
      pathValue: path.join(root, "empty-bin"),
      cwd: root,
      homeDir,
    })).resolves.toBe(expected);
  });

  it("treats the first existing PATH candidate as authoritative when it is not executable", async () => {
    const root = await makeRoot();
    const shadowBin = path.join(root, "shadow-bin");
    const laterBin = path.join(root, "later-bin");
    const homeDir = path.join(root, "home");
    const shadow = await executable(path.join(shadowBin, "kimi"));
    await fs.chmod(shadow, 0o644);
    await executable(path.join(laterBin, "kimi"));
    await executable(path.join(homeDir, ".kimi-code", "bin", "kimi"));

    await expect(resolveKimiExecutable({
      pathValue: [shadowBin, laterBin].join(path.delimiter),
      cwd: root,
      homeDir,
    })).rejects.toMatchObject({
      code: "kimi-cli-not-executable",
      safeMessage: expect.stringContaining("不可执行"),
    });
  });

  it.each([
    {
      name: "directory",
      prepare: async (candidate: string) => {
        await fs.mkdir(candidate, { recursive: true });
      },
      code: "kimi-cli-not-executable",
    },
    {
      name: "broken symlink",
      prepare: async (candidate: string) => {
        await fs.mkdir(path.dirname(candidate), { recursive: true });
        await fs.symlink(path.join(path.dirname(candidate), "missing-target"), candidate);
      },
      code: "kimi-cli-not-found",
    },
  ])("classifies a $name candidate without executing it", async ({ prepare, code }) => {
    const root = await makeRoot();
    const binDir = path.join(root, "bin");
    await prepare(path.join(binDir, "kimi"));

    await expect(resolveKimiExecutable({
      pathValue: binDir,
      cwd: root,
      homeDir: path.join(root, "home"),
    })).rejects.toMatchObject({ code });
  });

  it("reports a stable not-found failure without exposing candidate paths", async () => {
    const root = await makeRoot();
    const error = await resolveKimiExecutable({
      pathValue: path.join(root, "empty-bin"),
      cwd: root,
      homeDir: path.join(root, "host-home"),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(KimiExecutableError);
    expect(error).toMatchObject({
      code: "kimi-cli-not-found",
      safeMessage: "没有找到 Kimi CLI。请先安装 Kimi，然后重试。",
    });
    expect((error as Error).message).not.toContain(root);
  });

  it("classifies an inaccessible PATH candidate as not executable", async () => {
    const root = await makeRoot();
    const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });

    await expect(resolveKimiExecutable({
      pathValue: path.join(root, "denied-bin"),
      cwd: root,
      homeDir: path.join(root, "home"),
      stat: (async () => {
        throw denied;
      }) as typeof fs.stat,
    })).rejects.toMatchObject({
      code: "kimi-cli-not-executable",
      safeMessage: expect.stringContaining("不可执行"),
    });
  });

  it("resolves relative and empty PATH entries against the child cwd", async () => {
    const root = await makeRoot();
    const relative = await executable(path.join(root, "relative-bin", "kimi"));

    await expect(resolveKimiExecutable({
      pathValue: ["missing", "relative-bin", ""].join(path.delimiter),
      cwd: root,
      homeDir: os.homedir(),
    })).resolves.toBe(relative);
  });
});

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-kimi-executable-"));
  temporaryRoots.push(root);
  return root;
}

async function executable(filePath: string): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "#!/bin/sh\nexit 0\n", "utf8");
  await fs.chmod(filePath, 0o755);
  return path.resolve(filePath);
}
