import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getRoleThreadState,
  loadRoleThreadStateStore,
  saveRoleThreadStateEntry,
  saveRoleThreadStateStore,
  withRoleThreadState,
} from "../src/state.js";

describe("role thread state store", () => {
  it("returns an empty store when the state file does not exist", async () => {
    const filePath = path.join(await makeTempDir(), "missing", "role-threads.json");

    await expect(loadRoleThreadStateStore(filePath)).resolves.toEqual({});
  });

  it("saves and loads role thread state", async () => {
    const filePath = path.join(await makeTempDir(), ".state", "role-threads.json");
    const store = withRoleThreadState({}, "tranfu-labs/moebius#3", "product-manager", {
      threadId: "thread-1",
      lastSeenIndex: 4,
      provider: "codex",
      contextFingerprint: "context-1",
      workspaceFingerprint: "workspace-1",
      personaFingerprint: "persona-1",
    });

    await saveRoleThreadStateStore(store, filePath);

    await expect(loadRoleThreadStateStore(filePath)).resolves.toEqual(store);
    expect(getRoleThreadState(store, "tranfu-labs/moebius#3", "product-manager")).toEqual({
      threadId: "thread-1",
      lastSeenIndex: 4,
      provider: "codex",
      contextFingerprint: "context-1",
      workspaceFingerprint: "workspace-1",
      personaFingerprint: "persona-1",
    });
    expect(getRoleThreadState(store, "tranfu-labs/moebius#3", "hermes-user")).toBeNull();
  });

  it("fails safely on invalid state shape", async () => {
    const filePath = path.join(await makeTempDir(), ".state", "role-threads.json");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ issue: { role: { threadId: "", lastSeenIndex: -1 } } }), "utf8");

    await expect(loadRoleThreadStateStore(filePath)).rejects.toThrow(/Invalid role thread state file/);
  });

  it("merges concurrent entry saves without overwriting other roles", async () => {
    const filePath = path.join(await makeTempDir(), ".state", "role-threads.json");

    await Promise.all([
      saveRoleThreadStateEntry(
        "tranfu-labs/moebius#3",
        "dev",
        { threadId: "thread-dev", lastSeenIndex: 2 },
        filePath,
      ),
      saveRoleThreadStateEntry(
        "tranfu-labs/moebius#4",
        "product-manager",
        { threadId: "thread-pm", lastSeenIndex: 5 },
        filePath,
      ),
    ]);

    await expect(loadRoleThreadStateStore(filePath)).resolves.toEqual({
      "tranfu-labs/moebius#3": {
        dev: { threadId: "thread-dev", lastSeenIndex: 2 },
      },
      "tranfu-labs/moebius#4": {
        "product-manager": { threadId: "thread-pm", lastSeenIndex: 5 },
      },
    });
  });

  it("migrates legacy issue role threads without sharing thread ids across issues", async () => {
    const filePath = path.join(await makeTempDir(), ".state", "role-threads.json");
    const legacyStore = {
      "tranfu-labs/moebius#101": {
        dev: { threadId: "thread-101", lastSeenIndex: 7 },
      },
      "tranfu-labs/moebius#102": {
        dev: { threadId: "thread-102", lastSeenIndex: 3 },
      },
    };
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(legacyStore), "utf8");

    const loaded = await loadRoleThreadStateStore(filePath);

    expect(getRoleThreadState(loaded, "tranfu-labs/moebius#101", "dev")).toEqual({
      threadId: "thread-101",
      lastSeenIndex: 7,
    });
    expect(getRoleThreadState(loaded, "tranfu-labs/moebius#102", "dev")).toEqual({
      threadId: "thread-102",
      lastSeenIndex: 3,
    });

    await saveRoleThreadStateEntry(
      "tranfu-labs/moebius#101",
      "dev",
      { threadId: "thread-101-resumed", lastSeenIndex: 8 },
      filePath,
    );
    const reloaded = await loadRoleThreadStateStore(filePath);

    expect(getRoleThreadState(reloaded, "tranfu-labs/moebius#101", "dev")).toEqual({
      threadId: "thread-101-resumed",
      lastSeenIndex: 8,
    });
    expect(getRoleThreadState(reloaded, "tranfu-labs/moebius#102", "dev")).toEqual({
      threadId: "thread-102",
      lastSeenIndex: 3,
    });
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe(JSON.stringify(legacyStore));
  });
});

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "moebius-state-test-"));
}
