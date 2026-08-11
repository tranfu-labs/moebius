import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createDesktopUpdateReadyStore,
  createDesktopUpdateSkipStore,
} from "../src/desktop-update-store.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("desktop update marker stores", () => {
  it("writes markers atomically and fails closed for missing or malformed data", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-update-store-"));
    temporaryRoots.push(root);
    const ready = createDesktopUpdateReadyStore(path.join(root, ".state", "ready.json"));
    const skipped = createDesktopUpdateSkipStore(path.join(root, ".state", "skipped.json"));

    await expect(ready.read()).resolves.toBeNull();
    await expect(skipped.read()).resolves.toBeNull();
    await ready.write({ version: "0.5.0" });
    await skipped.write({ version: "0.5.0" });
    await expect(ready.read()).resolves.toEqual({ version: "0.5.0" });
    await expect(skipped.read()).resolves.toEqual({ version: "0.5.0" });

    await fs.writeFile(path.join(root, ".state", "skipped.json"), JSON.stringify({ version: 5 }), "utf8");
    await expect(skipped.read()).resolves.toBeNull();
  });
});
