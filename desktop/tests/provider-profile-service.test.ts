import { describe, expect, it, vi } from "vitest";
import {
  createReadyProviderProfile,
  type ProviderOperation,
  type ProviderProfile,
  type ProviderReference,
} from "../../src/provider-profile.js";
import type { ProviderProfileStore } from "../../src/provider-profile-store.js";
import type { CredentialVault } from "../src/provider-credential-vault.js";
import { createProviderProfileService } from "../src/provider-profile-service.js";

function memoryStore(): ProviderProfileStore & {
  profiles: Map<string, ProviderProfile>;
  operations: Map<string, ProviderOperation>;
} {
  const profiles = new Map<string, ProviderProfile>();
  const operations = new Map<string, ProviderOperation>();
  return {
    profiles,
    operations,
    listProfiles: async () => [...profiles.values()],
    getProfile: async (id) => profiles.get(id) ?? null,
    putProfile: async (profile, expectedRevision) => {
      const current = profiles.get(profile.id);
      if ((current?.revision ?? null) !== expectedRevision) {
        throw new Error("revision conflict");
      }
      profiles.set(profile.id, profile);
      return profile;
    },
    commitProfileOperation: async (profile, expectedRevision, operation) => {
      const current = profiles.get(profile.id);
      if ((current?.revision ?? null) !== expectedRevision) {
        throw new Error("revision conflict");
      }
      profiles.set(profile.id, profile);
      operations.set(operation.id, operation);
      return profile;
    },
    deleteProfile: async (id, expectedRevision) => {
      if (profiles.get(id)?.revision !== expectedRevision) {
        throw new Error("revision conflict");
      }
      return profiles.delete(id);
    },
    listOperations: async (profileId) => [...operations.values()]
      .filter((operation) => profileId === undefined || operation.profileId === profileId),
    listSessionReferences: async () => [],
    putOperation: async (operation) => {
      operations.set(operation.id, operation);
      return operation;
    },
  };
}

function memoryVault(): CredentialVault & { values: Map<string, string> } {
  const values = new Map<string, string>();
  let nextId = 0;
  return {
    values,
    stage: async (apiKey) => {
      const id = `provider-credential:${String(++nextId)}`;
      values.set(id, apiKey);
      return id;
    },
    read: async (id) => {
      const value = values.get(id);
      if (value === undefined) throw Object.assign(new Error("missing"), { code: "CREDENTIAL_NOT_FOUND" });
      return value;
    },
    remove: async (id) => { values.delete(id); },
    has: async (id) => values.has(id),
    pruneExcept: async (retained) => {
      const removed = [...values.keys()].filter((id) => !retained.has(id));
      for (const id of removed) values.delete(id);
      return removed;
    },
  };
}

function fixture(references: ProviderReference[] = []) {
  const store = memoryStore();
  const vault = memoryVault();
  const validator = {
    validate: vi.fn(async (_input: {
      providerId: "deepseek";
      model: "deepseek-v4-flash" | "deepseek-v4-pro";
      apiKey: string;
      signal?: AbortSignal;
    }): Promise<undefined> => undefined),
  };
  let tick = 0;
  const migrate = vi.fn(async ({ references: selected, onCommitted }: Parameters<import("../src/provider-profile-service.js").ProviderReferencePort["migrate"]>[0]) => {
    await onCommitted(selected.map((reference) => reference.ownerId));
  });
  const end = vi.fn(async ({ references: selected, onCommitted }: Parameters<import("../src/provider-profile-service.js").ProviderReferencePort["end"]>[0]) => {
    await onCommitted(selected.map((reference) => reference.ownerId));
  });
  const service = createProviderProfileService({
    store,
    vault,
    validator,
    references: {
      list: async () => references,
      migrate,
      end,
    },
    allocateProfileId: () => "profile-1",
    now: () => `2026-08-04T12:00:0${String(tick++)}.000Z`,
  });
  return { service, store, vault, validator, migrate, end };
}

describe("provider profile service", () => {
  it("recovers interrupted operations and prunes orphaned credential revisions", async () => {
    const store = memoryStore();
    const vault = memoryVault();
    const retained = await vault.stage("sk-retained-secret");
    const orphaned = await vault.stage("sk-orphaned-secret");
    store.profiles.set("profile-1", createReadyProviderProfile({
      id: "profile-1",
      providerId: "deepseek",
      displayName: "生产账号",
      credentialRef: retained,
      keySuffix: "cret",
      defaultModel: "deepseek-v4-pro",
      verifiedModels: ["deepseek-v4-pro"],
      now: "2026-08-04T12:00:00.000Z",
    }));
    store.operations.set("rotate-interrupted", {
      id: "rotate-interrupted",
      profileId: "profile-1",
      kind: "rotate-key",
      status: "saving",
      baseRevision: 1,
      targetModels: ["deepseek-v4-pro"],
      completedTargets: ["deepseek-v4-pro"],
      safeReason: null,
      startedAt: "2026-08-04T12:00:01.000Z",
      updatedAt: "2026-08-04T12:00:02.000Z",
    });
    const service = createProviderProfileService({
      store,
      vault,
      validator: { validate: vi.fn(async () => undefined) },
      references: {
        list: async () => [],
        migrate: async () => undefined,
        end: async () => undefined,
      },
      now: () => "2026-08-04T12:01:00.000Z",
    });

    await service.recoverInterrupted();

    expect(store.operations.get("rotate-interrupted")).toMatchObject({
      status: "failed",
      safeReason: "local-save-failed",
    });
    expect(store.profiles.get("profile-1")).toMatchObject({
      readiness: "ready",
      reason: "local-save-failed",
      revision: 2,
      credentialRef: retained,
    });
    expect(vault.values.has(retained)).toBe(true);
    expect(vault.values.has(orphaned)).toBe(false);
  });

  it("calibrates missing and undecryptable ready profiles independently on startup", async () => {
    const store = memoryStore();
    const vault = memoryVault();
    const goodCredentialRef = await vault.stage("sk-good-secret");
    const missingCredentialRef = "provider-credential:missing";
    const undecryptableCredentialRef = "provider-credential:undecryptable";
    const missing = createReadyProviderProfile({
      id: "profile-missing",
      providerId: "deepseek",
      displayName: "缺失凭据",
      credentialRef: missingCredentialRef,
      keySuffix: "sing",
      defaultModel: "deepseek-v4-pro",
      verifiedModels: ["deepseek-v4-pro"],
      now: "2026-08-04T12:00:00.000Z",
    });
    const undecryptable = createReadyProviderProfile({
      id: "profile-undecryptable",
      providerId: "deepseek",
      displayName: "不可解密凭据",
      credentialRef: undecryptableCredentialRef,
      keySuffix: "able",
      defaultModel: "deepseek-v4-flash",
      verifiedModels: ["deepseek-v4-flash"],
      now: "2026-08-04T12:00:00.000Z",
    });
    const healthy = createReadyProviderProfile({
      id: "profile-healthy",
      providerId: "deepseek",
      displayName: "健康凭据",
      credentialRef: goodCredentialRef,
      keySuffix: "cret",
      defaultModel: "deepseek-v4-pro",
      verifiedModels: ["deepseek-v4-pro"],
      now: "2026-08-04T12:00:00.000Z",
    });
    store.profiles.set(missing.id, missing);
    store.profiles.set(undecryptable.id, undecryptable);
    store.profiles.set(healthy.id, healthy);

    const originalRead = vault.read.bind(vault);
    vi.spyOn(vault, "read").mockImplementation(async (credentialRef) => {
      if (credentialRef === undecryptableCredentialRef) {
        throw Object.assign(new Error("safeStorage identity mismatch"), {
          code: "CREDENTIAL_DECRYPTION_FAILED",
        });
      }
      return await originalRead(credentialRef);
    });
    const validator = { validate: vi.fn(async () => undefined) };
    const service = createProviderProfileService({
      store,
      vault,
      validator,
      references: {
        list: async () => [],
        migrate: async () => undefined,
        end: async () => undefined,
      },
      now: () => "2026-08-04T12:01:00.000Z",
    });

    await service.recoverInterrupted();

    expect(store.profiles.get(missing.id)).toMatchObject({
      readiness: "needs-attention",
      reason: "credential-invalid",
      revision: 2,
      credentialRef: missingCredentialRef,
    });
    expect(store.profiles.get(undecryptable.id)).toMatchObject({
      readiness: "needs-attention",
      reason: "credential-invalid",
      revision: 2,
      credentialRef: undecryptableCredentialRef,
    });
    expect(store.profiles.get(healthy.id)).toMatchObject({
      readiness: "ready",
      reason: null,
      revision: 1,
      credentialRef: goodCredentialRef,
    });
    expect(new Set([
      store.profiles.get(missing.id)?.credentialRef,
      store.profiles.get(undecryptable.id)?.credentialRef,
      store.profiles.get(healthy.id)?.credentialRef,
    ]).size).toBe(3);
    expect(validator.validate).not.toHaveBeenCalled();
  });

  it("retries startup recovery after a transient store failure", async () => {
    const store = memoryStore();
    const vault = memoryVault();
    const listProfiles = vi.spyOn(store, "listProfiles")
      .mockRejectedValueOnce(new Error("sqlite not ready"));
    const service = createProviderProfileService({
      store,
      vault,
      validator: { validate: vi.fn(async () => undefined) },
      references: {
        list: async () => [],
        migrate: async () => undefined,
        end: async () => undefined,
      },
    });

    await expect(service.list()).rejects.toThrow("sqlite not ready");
    await expect(service.list()).resolves.toEqual([]);
    expect(listProfiles).toHaveBeenCalledTimes(3);
  });

  it("validates before saving and returns no credential reference", async () => {
    const { service, store, vault, validator } = fixture();
    const summary = await service.create({
      operationId: "operation-1",
      displayName: "生产账号",
      apiKey: "sk-secret-value",
      defaultModel: "deepseek-v4-pro",
    });
    expect(validator.validate).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      apiKey: "sk-secret-value",
    }));
    expect(summary).not.toHaveProperty("credentialRef");
    expect(JSON.stringify(summary)).not.toContain("sk-secret-value");
    expect(store.profiles.get("profile-1")?.credentialRef).toBe("provider-credential:1");
    expect([...vault.values.values()]).toEqual(["sk-secret-value"]);
  });

  it("retries a failed local create save without validating again", async () => {
    const { service, store, vault, validator } = fixture();
    vi.spyOn(store, "commitProfileOperation").mockRejectedValueOnce(new Error("sqlite commit failed"));

    await expect(service.create({
      operationId: "operation-atomic-failure",
      displayName: "生产账号",
      apiKey: "sk-secret-value",
      defaultModel: "deepseek-v4-pro",
    })).rejects.toMatchObject({ code: "PROVIDER_LOCAL_SAVE_FAILED" });
    expect(store.profiles.size).toBe(0);
    expect(vault.values.size).toBe(0);

    await expect(service.retryCreateSave("operation-atomic-failure")).resolves.toMatchObject({
      displayName: "生产账号",
      readiness: "ready",
    });
    expect(validator.validate).toHaveBeenCalledTimes(1);
    expect(store.profiles.size).toBe(1);
    expect(vault.values.size).toBe(1);
  });

  it("discards an in-memory validated create candidate when the form closes", async () => {
    const { service, store, vault } = fixture();
    vi.spyOn(store, "commitProfileOperation").mockRejectedValueOnce(new Error("sqlite commit failed"));
    await expect(service.create({
      operationId: "operation-discard-save",
      displayName: "生产账号",
      apiKey: "sk-secret-value",
      defaultModel: "deepseek-v4-pro",
    })).rejects.toMatchObject({ code: "PROVIDER_LOCAL_SAVE_FAILED" });

    await service.discardCreateSave("operation-discard-save");

    await expect(service.retryCreateSave("operation-discard-save")).rejects.toMatchObject({
      code: "PROVIDER_CREATE_SAVE_NOT_RETRYABLE",
    });
    expect(store.profiles.size).toBe(0);
    expect(vault.values.size).toBe(0);
  });

  it("records cancellation without creating a profile or retaining a credential", async () => {
    const { service, store, vault, validator } = fixture();
    validator.validate.mockImplementationOnce(async (validation: { signal?: AbortSignal }): Promise<undefined> => {
      await new Promise<void>((_resolve, reject) => {
        if (validation.signal?.aborted === true) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        validation.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      });
      return undefined;
    });
    const controller = new AbortController();
    const creating = service.create({
      operationId: "operation-cancel",
      displayName: "生产账号",
      apiKey: "sk-secret-value",
      defaultModel: "deepseek-v4-pro",
      signal: controller.signal,
    });
    controller.abort();

    await expect(creating).rejects.toMatchObject({ code: "PROVIDER_OPERATION_CANCELLED" });
    expect(store.operations.get("operation-cancel")).toMatchObject({ status: "cancelled" });
    expect(store.profiles.size).toBe(0);
    expect(vault.values.size).toBe(0);
  });

  it("keeps the old revision and credential when rotation partially fails", async () => {
    const { service, store, vault, validator } = fixture();
    await service.create({
      operationId: "create",
      displayName: "生产账号",
      apiKey: "sk-old-secret",
      defaultModel: "deepseek-v4-pro",
    });
    const current = store.profiles.get("profile-1")!;
    store.profiles.set("profile-1", {
      ...current,
      verifiedModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
    });
    validator.validate
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error("rate limit"), { code: "rate-limited" }));

    await expect(service.rotateKey({
      operationId: "rotate",
      profileId: "profile-1",
      expectedRevision: 1,
      apiKey: "sk-new-secret",
    })).rejects.toThrow("rate limit");
    expect(store.profiles.get("profile-1")).toMatchObject({ revision: 1, credentialRef: "provider-credential:1" });
    expect([...vault.values.values()]).toEqual(["sk-old-secret"]);
    expect(store.operations.get("rotate")).toMatchObject({ status: "failed", safeReason: "rate-limited" });
  });

  it("maps enable failures to the unique readiness states", async () => {
    const { service, store, validator } = fixture();
    await service.create({
      operationId: "create",
      displayName: "生产账号",
      apiKey: "sk-old-secret",
      defaultModel: "deepseek-v4-pro",
    });
    await service.disable("profile-1", 1);
    validator.validate.mockRejectedValueOnce(Object.assign(new Error("offline"), { code: "network" }));
    expect(await service.enable({
      operationId: "enable-network",
      profileId: "profile-1",
      expectedRevision: 2,
    })).toMatchObject({ readiness: "disabled", reason: "network" });

    validator.validate.mockRejectedValueOnce(Object.assign(new Error("bad key"), { code: "auth" }));
    expect(await service.enable({
      operationId: "enable-auth",
      profileId: "profile-1",
      expectedRevision: 3,
    })).toMatchObject({ readiness: "needs-attention", reason: "credential-invalid" });
    expect(store.profiles.get("profile-1")?.revision).toBe(4);
  });

  it("withdraws readiness after a configuration failure discovered by a real run", async () => {
    const { service, store } = fixture();
    await service.create({
      operationId: "create",
      displayName: "生产账号",
      apiKey: "sk-old-secret",
      defaultModel: "deepseek-v4-pro",
    });

    await service.recordRuntimeFailure("profile-1", "credential-invalid");
    expect(store.profiles.get("profile-1")).toMatchObject({
      readiness: "needs-attention",
      reason: "credential-invalid",
      revision: 2,
    });
  });

  it("validates added models, requires an explicit default, and protects referenced removals", async () => {
    const references: ProviderReference[] = [{
      kind: "team-member",
      ownerId: "team-1/dev",
      label: "开发 Agent",
      profileId: "profile-1",
      model: "deepseek-v4-pro",
    }];
    const { service, store, validator } = fixture(references);
    await service.create({
      operationId: "create",
      displayName: "生产账号",
      apiKey: "sk-old-secret",
      defaultModel: "deepseek-v4-pro",
    });
    expect(await service.addModel({
      operationId: "add-flash",
      profileId: "profile-1",
      expectedRevision: 1,
      model: "deepseek-v4-flash",
    })).toMatchObject({
      revision: 2,
      verifiedModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
      defaultModel: "deepseek-v4-pro",
    });
    expect(validator.validate).toHaveBeenLastCalledWith(expect.objectContaining({
      model: "deepseek-v4-flash",
      apiKey: "sk-old-secret",
    }));
    expect(await service.setDefaultModel("profile-1", 2, "deepseek-v4-flash"))
      .toMatchObject({ revision: 3, defaultModel: "deepseek-v4-flash" });
    await expect(service.removeModel("profile-1", 3, "deepseek-v4-pro"))
      .rejects.toMatchObject({ code: "PROVIDER_MODEL_REFERENCED" });
    expect(store.profiles.get("profile-1")).toMatchObject({
      revision: 3,
      verifiedModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
    });
  });

  it("replaces the default and removes the old model in one profile revision", async () => {
    const { service, store } = fixture();
    await service.create({
      operationId: "create",
      displayName: "生产账号",
      apiKey: "sk-old-secret",
      defaultModel: "deepseek-v4-pro",
    });
    await service.addModel({
      operationId: "add-flash",
      profileId: "profile-1",
      expectedRevision: 1,
      model: "deepseek-v4-flash",
    });

    await expect(service.replaceDefaultAndRemoveModel(
      "profile-1",
      2,
      "deepseek-v4-pro",
      "deepseek-v4-flash",
    )).resolves.toMatchObject({
      revision: 3,
      defaultModel: "deepseek-v4-flash",
      verifiedModels: ["deepseek-v4-flash"],
    });
    expect(store.profiles.get("profile-1")).toMatchObject({
      revision: 3,
      defaultModel: "deepseek-v4-flash",
      verifiedModels: ["deepseek-v4-flash"],
    });
  });

  it("blocks deletion while canonical references remain", async () => {
    const { service, store, vault } = fixture([{
      kind: "team-member",
      ownerId: "team-1/dev",
      label: "开发 Agent",
      profileId: "profile-1",
      model: "deepseek-v4-pro",
    }]);
    await service.create({
      operationId: "create",
      displayName: "生产账号",
      apiKey: "sk-old-secret",
      defaultModel: "deepseek-v4-pro",
    });
    await expect(service.delete("profile-1", 1)).rejects.toMatchObject({ code: "PROVIDER_MODEL_REFERENCED" });
    expect(store.profiles.has("profile-1")).toBe(true);
    expect(vault.values.size).toBe(1);
  });

  it("validates migration targets and journals committed canonical references", async () => {
    const references: ProviderReference[] = [{
      kind: "resumable-session",
      ownerId: "session-1:effective:@dev",
      label: "修复登录流程",
      profileId: "profile-1",
      model: "deepseek-v4-pro",
    }];
    const { service, store, migrate, end } = fixture(references);
    await service.create({
      operationId: "create",
      displayName: "生产账号",
      apiKey: "sk-old-secret",
      defaultModel: "deepseek-v4-pro",
    });
    store.profiles.set("profile-2", createReadyProviderProfile({
      id: "profile-2",
      providerId: "deepseek",
      displayName: "迁移目标",
      credentialRef: "credential:target",
      keySuffix: "5678",
      defaultModel: "deepseek-v4-flash",
      verifiedModels: ["deepseek-v4-flash"],
      now: "2026-08-04T12:00:00.000Z",
    }));

    await service.migrateReferences({
      operationId: "migrate-session",
      profileId: "profile-1",
      expectedRevision: 1,
      ownerIds: [references[0]!.ownerId],
      targetProfileId: "profile-2",
      targetModel: "deepseek-v4-flash",
    });
    expect(migrate).toHaveBeenCalledWith(expect.objectContaining({
      references,
      targetModel: "deepseek-v4-flash",
    }));
    expect(store.operations.get("migrate-session")).toMatchObject({
      status: "completed",
      completedTargets: [references[0]!.ownerId],
    });

    await service.endReferences({
      operationId: "end-session",
      profileId: "profile-1",
      expectedRevision: 1,
      ownerIds: [references[0]!.ownerId],
    });
    expect(end).toHaveBeenCalledWith(expect.objectContaining({ references }));
  });

  it("surfaces an interrupted migration and retries only references still on the source", async () => {
    const first = {
      kind: "resumable-session" as const,
      ownerId: "session-1:effective:@dev",
      label: "已提交会话",
      profileId: "profile-1",
      model: "deepseek-v4-pro" as const,
    };
    const second = {
      kind: "resumable-session" as const,
      ownerId: "session-2:effective:@dev",
      label: "待提交会话",
      profileId: "profile-1",
      model: "deepseek-v4-pro" as const,
    };
    const references: ProviderReference[] = [first, second];
    const { service, store, migrate } = fixture(references);
    await service.create({
      operationId: "create",
      displayName: "生产账号",
      apiKey: "sk-old-secret",
      defaultModel: "deepseek-v4-pro",
    });
    store.profiles.set("profile-2", createReadyProviderProfile({
      id: "profile-2",
      providerId: "deepseek",
      displayName: "迁移目标",
      credentialRef: "credential:target",
      keySuffix: "5678",
      defaultModel: "deepseek-v4-flash",
      verifiedModels: ["deepseek-v4-flash"],
      now: "2026-08-04T12:00:00.000Z",
    }));
    migrate.mockImplementationOnce(async ({ references: selected, onCommitted }) => {
      await onCommitted([selected[0]!.ownerId]);
      references.splice(0, 1);
      throw new Error("second reference failed");
    });

    await expect(service.migrateReferences({
      operationId: "migration-recovery",
      profileId: "profile-1",
      expectedRevision: 1,
      ownerIds: [first.ownerId, second.ownerId],
      targetProfileId: "profile-2",
      targetModel: "deepseek-v4-flash",
    })).rejects.toThrow("second reference failed");

    expect((await service.list())[0]?.activity).toMatchObject({
      id: "migration-recovery",
      status: "failed",
      completedTargets: [first.ownerId],
      targetOwnerIds: [first.ownerId, second.ownerId],
      targetProfileId: "profile-2",
    });

    await service.retryReferenceOperation("migration-recovery");
    expect(migrate).toHaveBeenLastCalledWith(expect.objectContaining({ references: [second] }));
    expect((await service.list())[0]?.activity).toBeNull();
  });

  it("reconciles committed destination references after a crash before the owner ledger write", async () => {
    const store = memoryStore();
    const vault = memoryVault();
    const source = createReadyProviderProfile({
      id: "profile-1",
      providerId: "deepseek",
      displayName: "生产账号",
      credentialRef: "credential:source",
      keySuffix: "1234",
      defaultModel: "deepseek-v4-pro",
      verifiedModels: ["deepseek-v4-pro"],
      now: "2026-08-04T12:00:00.000Z",
    });
    const target = createReadyProviderProfile({
      id: "profile-2",
      providerId: "deepseek",
      displayName: "迁移目标",
      credentialRef: "credential:target",
      keySuffix: "5678",
      defaultModel: "deepseek-v4-flash",
      verifiedModels: ["deepseek-v4-flash"],
      now: "2026-08-04T12:00:00.000Z",
    });
    store.profiles.set(source.id, source);
    store.profiles.set(target.id, target);
    vault.values.set("credential:source", "sk-source-secret");
    vault.values.set("credential:target", "sk-target-secret");
    const completed = {
      kind: "resumable-session" as const,
      ownerId: "session-completed:effective:@dev",
      label: "已提交会话",
      profileId: source.id,
      model: "deepseek-v4-pro" as const,
    };
    const pending = {
      kind: "resumable-session" as const,
      ownerId: "session-pending:effective:@dev",
      label: "待提交会话",
      profileId: source.id,
      model: "deepseek-v4-pro" as const,
    };
    const sourceReferences: ProviderReference[] = [pending];
    const targetReferences: ProviderReference[] = [{
      ...completed,
      profileId: target.id,
      model: "deepseek-v4-flash",
    }];
    store.operations.set("crashed-migration", {
      id: "crashed-migration",
      profileId: source.id,
      kind: "migrate",
      status: "migrating",
      baseRevision: source.revision,
      targetModels: ["deepseek-v4-flash"],
      completedTargets: [],
      targetProfileId: target.id,
      targetOwnerIds: [completed.ownerId, pending.ownerId],
      safeReason: null,
      startedAt: "2026-08-04T12:01:00.000Z",
      updatedAt: "2026-08-04T12:01:01.000Z",
    });
    const migrate = vi.fn(async ({ references: selected, onCommitted }: Parameters<import("../src/provider-profile-service.js").ProviderReferencePort["migrate"]>[0]) => {
      await onCommitted(selected.map((reference) => reference.ownerId));
    });
    const service = createProviderProfileService({
      store,
      vault,
      validator: { validate: vi.fn(async () => undefined) },
      references: {
        list: async (profileId) => profileId === source.id ? sourceReferences : targetReferences,
        migrate,
        end: async () => undefined,
      },
      now: () => "2026-08-04T12:02:00.000Z",
    });

    const sourceSummary = (await service.list()).find((profile) => profile.id === source.id);
    expect(sourceSummary?.activity).toMatchObject({
      status: "failed",
      completedTargets: [completed.ownerId],
      targetOwnerIds: [completed.ownerId, pending.ownerId],
    });

    await service.retryReferenceOperation("crashed-migration");
    expect(migrate).toHaveBeenCalledWith(expect.objectContaining({
      references: [pending],
    }));
  });

  it("projects safe references and keeps profile names unique across create and rename", async () => {
    const references: ProviderReference[] = [{
      kind: "resumable-session",
      ownerId: "session-1/dev",
      label: "修复登录流程",
      profileId: "profile-1",
      model: "deepseek-v4-pro",
    }];
    const { service } = fixture(references);
    const created = await service.create({
      operationId: "create",
      displayName: "生产账号",
      apiKey: "sk-old-secret",
      defaultModel: "deepseek-v4-pro",
    });
    expect(created.references).toEqual(references);
    expect(created).not.toHaveProperty("credentialRef");

    expect(await service.rename("profile-1", 1, "主账号"))
      .toMatchObject({ displayName: "主账号", revision: 2 });

    await expect(service.create({
      operationId: "duplicate-name",
      displayName: " 主账号 ",
      apiKey: "sk-another-secret",
      defaultModel: "deepseek-v4-flash",
    })).rejects.toMatchObject({ code: "PROVIDER_PROFILE_NAME_CONFLICT" });
  });
});
