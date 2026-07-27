import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAcceptanceOutputDirectory } from "../scripts/acceptance/temp-output.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("acceptance temporary output", () => {
  it("creates task-scoped evidence outside the repository", async () => {
    const output = await createAcceptanceOutputDirectory("contract-test");
    temporaryRoots.push(output);

    expect(path.dirname(output)).toBe(path.resolve(os.tmpdir()));
    expect(output).toContain(`${path.sep}moebius-contract-test-`);
    expect(path.resolve(output).startsWith(path.resolve("artifacts") + path.sep)).toBe(false);
  });

  it("rejects unsafe scope names", async () => {
    await expect(createAcceptanceOutputDirectory("../escape")).rejects.toThrow(
      "Invalid acceptance output scope",
    );
  });

  it("keeps acceptance and prototype verification path builders out of repository artifacts", async () => {
    const acceptanceScripts = (await fs.readdir("scripts/acceptance"))
      .filter((name) => name.endsWith(".ts"));
    const prototypeScripts = (await fs.readdir("prototypes/scripts"))
      .filter((name) => name.startsWith("verify-") && name.endsWith(".mjs"));

    for (const filePath of [
      ...acceptanceScripts.map((name) => path.join("scripts/acceptance", name)),
      ...prototypeScripts.map((name) => path.join("prototypes/scripts", name)),
    ]) {
      const source = await fs.readFile(filePath, "utf8");
      expect(source, filePath).not.toMatch(
        /(?:path\.join|resolve)\(\s*(?:projectRoot|repositoryRoot),\s*["']artifacts["']/u,
      );
    }

    await expect(fs.readFile(".gitignore", "utf8")).resolves.toContain("/artifacts/");
  });
});
