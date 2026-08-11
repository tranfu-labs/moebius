import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type {
  DesktopUpdateReadyStore,
  DesktopUpdateSkipStore,
} from "./desktop-update-contract.js";

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
      await writeMarkerAtomically(filePath, marker);
    },
    async clear(): Promise<void> {
      await fs.promises.rm(filePath, { force: true });
    },
  };
}

export function createDesktopUpdateSkipStore(filePath: string): DesktopUpdateSkipStore {
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
      await writeMarkerAtomically(filePath, marker);
    },
  };
}

async function writeMarkerAtomically(filePath: string, marker: { version: string }): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temporaryPath, JSON.stringify(marker), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.promises.rename(temporaryPath, filePath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
