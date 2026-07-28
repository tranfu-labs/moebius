import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("status page update entry", () => {
  it("removes the migrated update action and its deprecated IPC surface", async () => {
    const [html, statusScript, preload, main] = await Promise.all([
      fs.readFile(path.join(desktopRoot, "src/status-page/index.html"), "utf8"),
      fs.readFile(path.join(desktopRoot, "src/status-page/status.js"), "utf8"),
      fs.readFile(path.join(desktopRoot, "src/preload.ts"), "utf8"),
      fs.readFile(path.join(desktopRoot, "src/main.ts"), "utf8"),
    ]);

    expect(html).not.toContain("check-updates");
    expect(statusScript).not.toContain("checkUpdates");
    expect(preload).not.toContain("checkUpdates");
    expect(main).not.toContain("action:check-updates");
    expect(main).toContain("registerSettingsIpc");
  });
});
