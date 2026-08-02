import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeSqliteStateWorkers,
  readSqliteStateWorkerDiagnostics,
  runSqliteStateCommand,
} from "../src/sqlite-state.js";

describe("sqlite state persistence", () => {
  afterEach(async () => {
    await closeSqliteStateWorkers();
  });

  it("reuses a canonical lane through symlinks and reinitializes schema for each generation", async () => {
    const realRoot = await makeTempDir();
    const linkedRoot = `${realRoot}-link`;
    await fs.symlink(realRoot, linkedRoot, "dir");
    const realPath = path.join(realRoot, ".state", "local-console.sqlite");
    const linkedPath = path.join(linkedRoot, ".state", "local-console.sqlite");
    const createdBefore = readSqliteStateWorkerDiagnostics().createdWorkerCount;

    await runSqliteStateCommand({ sqlitePath: linkedPath, command: { kind: "local-init" } });
    await runSqliteStateCommand({ sqlitePath: realPath, command: { kind: "local-init" } });

    expect(readSqliteStateWorkerDiagnostics()).toMatchObject({
      laneCount: 1,
      workerCount: 1,
      createdWorkerCount: createdBefore + 1,
    });

    await closeSqliteStateWorkers({ sqlitePath: linkedPath });
    await fs.rm(realPath, { force: true });
    await fs.rm(`${realPath}-wal`, { force: true });
    await fs.rm(`${realPath}-shm`, { force: true });
    const emptyDatabase = new (await import("node:sqlite")).DatabaseSync(realPath);
    emptyDatabase.close();

    await expect(
      runSqliteStateCommand({ sqlitePath: realPath, command: { kind: "local-init" } }),
    ).resolves.toBeNull();
    expect(readSqliteStateWorkerDiagnostics().createdWorkerCount).toBe(createdBefore + 2);
  });
});

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "moebius-sqlite-state-test-"));
}

