import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createReadyProviderProfile, type ProviderOperation } from "../src/provider-profile.js";
import { createSqliteProviderProfileStore } from "../src/provider-profile-store.js";
import { closeSqliteStateWorkers } from "../src/sqlite-state.js";

const sqlitePaths: string[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(sqlitePaths.splice(0).map(async (sqlitePath) => closeSqliteStateWorkers({ sqlitePath })));
  await Promise.all(directories.splice(0).map(async (directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-provider-store-"));
  const sqlitePath = path.join(directory, "local-console.sqlite");
  directories.push(directory);
  sqlitePaths.push(sqlitePath);
  return createSqliteProviderProfileStore({ sqlitePath });
}

function profile() {
  return createReadyProviderProfile({
    id: "profile-1",
    providerId: "deepseek",
    displayName: "生产账号",
    credentialRef: "provider-credential:credential-1",
    keySuffix: "7K2M",
    defaultModel: "deepseek-v4-pro",
    verifiedModels: ["deepseek-v4-pro"],
    now: "2026-08-04T12:00:00.000Z",
  });
}

describe("SQLite provider profile store", () => {
  it("persists metadata without a key or ciphertext column", async () => {
    const store = await fixture();
    await store.putProfile(profile(), null);
    expect(await store.listProfiles()).toEqual([profile()]);

    const sqlitePath = sqlitePaths[0]!;
    await closeSqliteStateWorkers({ sqlitePath });
    const bytes = await fs.readFile(sqlitePath);
    expect(bytes.includes(Buffer.from("sk-secret-value"))).toBe(false);
    expect(bytes.includes(Buffer.from("ciphertext"))).toBe(false);
  });

  it("uses expected revision for atomic updates and delete", async () => {
    const store = await fixture();
    const initial = await store.putProfile(profile(), null);
    const updated = { ...initial, displayName: "新的名称", revision: 2, updatedAt: "2026-08-04T12:01:00.000Z" };
    await expect(store.putProfile(updated, 99)).rejects.toThrow("revision conflict");
    expect((await store.getProfile(initial.id))?.displayName).toBe("生产账号");

    expect(await store.putProfile(updated, 1)).toEqual(updated);
    await expect(store.deleteProfile(initial.id, 1)).rejects.toThrow("revision conflict");
    expect(await store.deleteProfile(initial.id, 2)).toBe(true);
  });

  it("commits a profile revision and operation terminal state in one transaction", async () => {
    const store = await fixture();
    const completed: ProviderOperation = {
      id: "operation-commit",
      profileId: "profile-1",
      kind: "create",
      status: "completed",
      baseRevision: null,
      targetModels: ["deepseek-v4-pro"],
      completedTargets: ["deepseek-v4-pro"],
      safeReason: null,
      startedAt: "2026-08-04T12:00:00.000Z",
      updatedAt: "2026-08-04T12:00:01.000Z",
    };
    expect(await store.commitProfileOperation(profile(), null, completed)).toEqual(profile());
    expect(await store.listOperations("profile-1")).toEqual([completed]);
  });

  it("persists operation activity independently from profile readiness", async () => {
    const store = await fixture();
    await store.putProfile(profile(), null);
    await store.putOperation({
      id: "operation-1",
      profileId: "profile-1",
      kind: "rotate-key",
      status: "validating",
      baseRevision: 1,
      targetModels: ["deepseek-v4-pro"],
      completedTargets: [],
      safeReason: null,
      startedAt: "2026-08-04T12:02:00.000Z",
      updatedAt: "2026-08-04T12:02:00.000Z",
    });
    expect(await store.getProfile("profile-1")).toMatchObject({ readiness: "ready", revision: 1 });
    expect(await store.listOperations("profile-1")).toEqual([
      expect.objectContaining({ status: "validating", baseRevision: 1 }),
    ]);
  });

  it("persists the destination and owner ledger for interrupted reference migrations", async () => {
    const store = await fixture();
    await store.putOperation({
      id: "migration-recovery",
      profileId: "profile-1",
      kind: "migrate",
      status: "failed",
      baseRevision: 1,
      targetModels: ["deepseek-v4-flash"],
      completedTargets: ["session-1"],
      targetProfileId: "profile-2",
      targetOwnerIds: ["session-1", "session-2"],
      safeReason: "local-save-failed",
      startedAt: "2026-08-04T12:02:00.000Z",
      updatedAt: "2026-08-04T12:02:03.000Z",
    });

    expect(await store.listOperations("profile-1")).toEqual([expect.objectContaining({
      id: "migration-recovery",
      targetProfileId: "profile-2",
      targetOwnerIds: ["session-1", "session-2"],
      completedTargets: ["session-1"],
    })]);
  });

  it("distinguishes effective sessions from pending queued task references", async () => {
    const store = await fixture();
    await store.putProfile(profile(), null);
    const sqlitePath = sqlitePaths[0]!;
    await closeSqliteStateWorkers({ sqlitePath });
    const database = new DatabaseSync(sqlitePath);
    database.prepare(
      `INSERT INTO sessions
        (session_id, source_type, status, title, created_at, updated_at)
       VALUES (?, 'fixture', 'open', '引用槽位', ?, ?)`,
    ).run("local:session-1", "2026-08-04T12:00:00.000Z", "2026-08-04T12:00:00.000Z");
    const insertMember = database.prepare(
      `INSERT INTO session_agent_team_members
        (session_id, slot, member_name, agent_markdown, sort_order,
         execution_cli, execution_model, execution_effort, provider_id, provider_profile_id)
       VALUES (?, ?, ?, '# Agent', ?, 'pi', 'deepseek-v4-pro', 'high', 'deepseek', 'profile-1')`,
    );
    insertMember.run("local:session-1", "effective", "@effective", 0);
    insertMember.run("local:session-1", "pending", "@pending", 0);
    database.close();

    await expect(store.listSessionReferences("profile-1")).resolves.toEqual([
      expect.objectContaining({
        kind: "resumable-session",
        ownerId: 'session:["local:session-1","effective","@effective"]',
      }),
      expect.objectContaining({
        kind: "queued-task",
        ownerId: 'session:["local:session-1","pending","@pending"]',
      }),
    ]);
  });
});
