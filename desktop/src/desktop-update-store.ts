import fs from "node:fs";
import path from "node:path";

import type { DesktopUpdateReadyStore } from "./desktop-update-contract.js";

export function createDesktopUpdateReadyStore(filePath: string): DesktopUpdateReadyStore {
  return {
    async read(): Promise<{ version: string } | null> {
      try {
        const raw = JSON.parse(await fs.promises.readFile(filePath, "utf8")) as { version?: unknown };
        return typeof raw.version === "string" && raw.version.trim() !== ""
          ? { version: raw.version }
          : null;
      } catch {
        return null;
      }
    },
    async write(marker: { version: string }): Promise<void> {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, JSON.stringify(marker), "utf8");
    },
    async clear(): Promise<void> {
      await fs.promises.rm(filePath, { force: true });
    },
  };
}
