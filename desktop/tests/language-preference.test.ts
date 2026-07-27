import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import {
  parseLanguagePreference,
  readLanguagePreference,
  resolveLanguagePreferencePath,
  saveLanguagePreference,
  type LanguagePreferenceWriteOperations,
} from "../src/language-preference.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-language-"));
  temporaryRoots.push(root);
  return root;
}

function failingWriteOperations(options: {
  writeError?: Error;
  renameError?: Error;
}): {
  operations: LanguagePreferenceWriteOperations;
  temporaryPath: string;
  writeFile: ReturnType<typeof vi.fn>;
  rename: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  const temporaryPath = "/test/language-preference.tmp";
  const writeFile = options.writeError === undefined
    ? vi.fn().mockResolvedValue(undefined)
    : vi.fn().mockRejectedValue(options.writeError);
  const rename = options.renameError === undefined
    ? vi.fn().mockResolvedValue(undefined)
    : vi.fn().mockRejectedValue(options.renameError);
  const remove = vi.fn().mockResolvedValue(undefined);
  return {
    operations: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile,
      rename,
      remove,
      createTemporaryPath: () => temporaryPath,
    },
    temporaryPath,
    writeFile,
    rename,
    remove,
  };
}

describe("language preference", () => {
  it("defaults missing, malformed and unsupported documents to Simplified Chinese", () => {
    expect(parseLanguagePreference(null)).toBe("zh-CN");
    expect(parseLanguagePreference({ version: 2, locale: "en" })).toBe("zh-CN");
    expect(parseLanguagePreference({ version: 1, locale: "fr" })).toBe("zh-CN");
    expect(parseLanguagePreference({ version: 1, locale: "en" })).toBe("en");
  });

  it("writes and restores a versioned preference atomically", async () => {
    const root = await temporaryRoot();
    expect(await readLanguagePreference(root)).toBe("zh-CN");

    await saveLanguagePreference(root, "en");

    expect(await readLanguagePreference(root)).toBe("en");
    const files = await fs.readdir(path.dirname(resolveLanguagePreferencePath(root)));
    expect(files).toEqual(["language-preference.json"]);
  });

  it("falls back when the saved file is invalid JSON", async () => {
    const root = await temporaryRoot();
    const preferencePath = resolveLanguagePreferencePath(root);
    await fs.mkdir(path.dirname(preferencePath), { recursive: true });
    await fs.writeFile(preferencePath, "{invalid", "utf8");
    expect(await readLanguagePreference(root)).toBe("zh-CN");
  });

  it("removes the temporary file when writing fails", async () => {
    const writeError = new Error("write failed");
    const fixture = failingWriteOperations({ writeError });

    await expect(saveLanguagePreference("/data", "en", fixture.operations)).rejects.toBe(writeError);
    expect(fixture.writeFile).toHaveBeenCalledWith(
      fixture.temporaryPath,
      expect.stringContaining('"locale": "en"'),
    );
    expect(fixture.rename).not.toHaveBeenCalled();
    expect(fixture.remove).toHaveBeenCalledWith(fixture.temporaryPath);
  });

  it("removes the temporary file when atomic rename fails", async () => {
    const renameError = new Error("rename failed");
    const fixture = failingWriteOperations({ renameError });

    await expect(saveLanguagePreference("/data", "en", fixture.operations)).rejects.toBe(renameError);
    expect(fixture.rename).toHaveBeenCalledWith(
      fixture.temporaryPath,
      resolveLanguagePreferencePath("/data"),
    );
    expect(fixture.remove).toHaveBeenCalledWith(fixture.temporaryPath);
  });
});
