import { randomUUID } from "node:crypto";
import {
  PROVIDER_CATALOG,
  ProviderReferenceError,
  classifyProviderFailure,
  createReadyProviderProfile,
  keySuffix,
  normalizeProviderModel,
  normalizeProviderProfile,
  removeVerifiedModel,
  rotateProviderProfile,
  type DeepSeekModelId,
  type ProviderOperation,
  type ProviderProfile,
  type ProviderReference,
  type SafeProviderReason,
} from "../../src/provider-profile.js";
import type { ProviderProfileStore } from "../../src/provider-profile-store.js";
import type { CredentialVault } from "./provider-credential-vault.js";

export interface ProviderValidationPort {
  validate(input: {
    providerId: "deepseek";
    model: DeepSeekModelId;
    apiKey: string;
    signal?: AbortSignal;
  }): Promise<void>;
}

export interface ProviderReferencePort {
  list(profileId: string): Promise<ProviderReference[]>;
  migrate(input: {
    references: readonly ProviderReference[];
    targetProfile: ProviderProfile;
    targetModel: DeepSeekModelId;
    onCommitted(ownerIds: readonly string[]): Promise<void>;
  }): Promise<void>;
  end(input: {
    references: readonly ProviderReference[];
    onCommitted(ownerIds: readonly string[]): Promise<void>;
  }): Promise<void>;
}

export interface ProviderProfileSummary {
  id: string;
  providerId: "deepseek";
  providerName: string;
  displayName: string;
  keySuffix: string;
  defaultModel: DeepSeekModelId | null;
  verifiedModels: DeepSeekModelId[];
  readiness: ProviderProfile["readiness"];
  reason: ProviderProfile["reason"];
  revision: number;
  updatedAt: string;
  references: ProviderReference[];
  activity: {
    id: string;
    kind: ProviderOperation["kind"];
    status: ProviderOperation["status"];
    completedTargets: string[];
    targetModels: DeepSeekModelId[];
    targetProfileId: string | null;
    targetOwnerIds: string[];
  } | null;
}

export interface ProviderProfileService {
  list(): Promise<ProviderProfileSummary[]>;
  create(input: {
    operationId: string;
    displayName: string;
    apiKey: string;
    defaultModel: string;
    signal?: AbortSignal;
  }): Promise<ProviderProfileSummary>;
  retryCreateSave(operationId: string): Promise<ProviderProfileSummary>;
  discardCreateSave(operationId: string): Promise<void>;
  rotateKey(input: {
    operationId: string;
    profileId: string;
    expectedRevision: number;
    apiKey: string;
    signal?: AbortSignal;
  }): Promise<ProviderProfileSummary>;
  disable(profileId: string, expectedRevision: number): Promise<ProviderProfileSummary>;
  enable(input: {
    operationId: string;
    profileId: string;
    expectedRevision: number;
    signal?: AbortSignal;
  }): Promise<ProviderProfileSummary>;
  addModel(input: {
    operationId: string;
    profileId: string;
    expectedRevision: number;
    model: string;
    signal?: AbortSignal;
  }): Promise<ProviderProfileSummary>;
  setDefaultModel(profileId: string, expectedRevision: number, model: string): Promise<ProviderProfileSummary>;
  removeModel(profileId: string, expectedRevision: number, model: string): Promise<ProviderProfileSummary>;
  replaceDefaultAndRemoveModel(profileId: string, expectedRevision: number, model: string, replacementDefaultModel: string): Promise<ProviderProfileSummary>;
  rename(profileId: string, expectedRevision: number, displayName: string): Promise<ProviderProfileSummary>;
  migrateReferences(input: {
    operationId: string;
    profileId: string;
    expectedRevision: number;
    ownerIds: string[];
    targetProfileId: string;
    targetModel: string;
  }): Promise<ProviderProfileSummary>;
  retryReferenceOperation(operationId: string): Promise<ProviderProfileSummary>;
  endReferences(input: {
    operationId: string;
    profileId: string;
    expectedRevision: number;
    ownerIds: string[];
  }): Promise<ProviderProfileSummary>;
  delete(profileId: string, expectedRevision: number): Promise<void>;
  recordRuntimeFailure(profileId: string, reason: SafeProviderReason): Promise<void>;
  recoverInterrupted(): Promise<void>;
}

export function createProviderProfileService(input: {
  store: ProviderProfileStore;
  vault: CredentialVault;
  validator: ProviderValidationPort;
  references: ProviderReferencePort;
  allocateProfileId?: () => string;
  now?: () => string;
}): ProviderProfileService {
  const allocateProfileId = input.allocateProfileId ?? randomUUID;
  const now = input.now ?? (() => new Date().toISOString());
  let recovery: Promise<void> | null = null;
  const pendingCreateSaves = new Map<string, {
    operation: ProviderOperation;
    profileId: string;
    displayName: string;
    apiKey: string;
    model: DeepSeekModelId;
    startedAt: string;
  }>();
  const recoverInterrupted = async (): Promise<void> => {
    const profiles = await input.store.listProfiles();
    const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
    const operations = await input.store.listOperations();
    for (const operation of operations.filter(isInterruptedOperation)) {
      const recoveredAt = now();
      const profile = profilesById.get(operation.profileId);
      if (profile === undefined) {
        await input.store.putOperation(failedOperation(operation, "local-save-failed", recoveredAt));
        continue;
      }
      if (operation.kind === "migrate") {
        // A reference migration keeps the source profile usable. Its journal is
        // the recovery surface; changing profile readiness would hide the
        // completed/unfinished object split from the user. Reconcile the
        // durable object state as well: a process can crash after the target
        // object commits but before onCommitted persists its owner ID.
        const reconciled = await inferCompletedReferenceTargets(operation, input.references);
        await input.store.putOperation(failedOperation(reconciled, "local-save-failed", recoveredAt));
        continue;
      }
      const failed = failedOperation(operation, "local-save-failed", recoveredAt);
      const recovered = normalizeProviderProfile({
        ...profile,
        reason: "local-save-failed",
        revision: profile.revision + 1,
        updatedAt: recoveredAt,
      });
      await input.store.commitProfileOperation(recovered, profile.revision, failed);
      profilesById.set(recovered.id, recovered);
    }

    // Readiness is a product promise, not merely a persisted metadata bit.
    // A profile can be left looking ready when the credential vault was
    // replaced, copied across app identities, or otherwise lost between
    // launches. Calibrate every ready profile before pruning the vault so the
    // settings page exposes the repair path before a run is attempted.
    for (const profile of [...profilesById.values()]) {
      if (profile.readiness !== "ready") continue;
      try {
        await input.vault.read(profile.credentialRef);
      } catch {
        const calibrated = normalizeProviderProfile({
          ...profile,
          readiness: "needs-attention",
          reason: "credential-invalid",
          revision: profile.revision + 1,
          updatedAt: now(),
        });
        const saved = await input.store.putProfile(calibrated, profile.revision);
        profilesById.set(saved.id, saved);
      }
    }

    await input.vault.pruneExcept(new Set(
      [...profilesById.values()].map((profile) => profile.credentialRef),
    ));
  };
  const ensureRecovered = async (): Promise<void> => {
    if (recovery === null) {
      const pending = recoverInterrupted().catch((error: unknown) => {
        if (recovery === pending) recovery = null;
        throw error;
      });
      recovery = pending;
    }
    await recovery;
  };

  const summarize = async (profile: ProviderProfile): Promise<ProviderProfileSummary> => {
    const [operations, references] = await Promise.all([
      input.store.listOperations(profile.id),
      input.references.list(profile.id),
    ]);
    const activity = [...operations]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .find(isVisibleProviderActivity) ?? null;
    return toSummary(profile, activity, references);
  };

  const persistPendingCreate = async (operationId: string): Promise<ProviderProfileSummary> => {
    const pending = pendingCreateSaves.get(operationId);
    if (pending === undefined) {
      throw new ProviderProfileServiceError(
        "PROVIDER_CREATE_SAVE_NOT_RETRYABLE",
        "这次验证结果已不可重试保存，请重新验证。",
      );
    }
    await requireUniqueDisplayName(input.store, pending.displayName);
    const saving: ProviderOperation = {
      ...pending.operation,
      status: "saving",
      completedTargets: [pending.model],
      safeReason: null,
      updatedAt: now(),
    };
    try {
      await input.store.putOperation(saving);
      const credentialRef = await input.vault.stage(pending.apiKey, now());
      try {
        const completedAt = now();
        const saved = await input.store.commitProfileOperation(createReadyProviderProfile({
          id: pending.profileId,
          providerId: "deepseek",
          displayName: pending.displayName,
          credentialRef,
          keySuffix: keySuffix(pending.apiKey),
          defaultModel: pending.model,
          verifiedModels: [pending.model],
          now: pending.startedAt,
        }), null, completedOperation(saving, [pending.model], completedAt));
        pendingCreateSaves.delete(operationId);
        return await summarize(saved);
      } catch (error) {
        await input.vault.remove(credentialRef).catch(() => undefined);
        throw error;
      }
    } catch {
      await failOperation(input.store, saving, "local-save-failed", now()).catch(() => undefined);
      throw new ProviderProfileServiceError(
        "PROVIDER_LOCAL_SAVE_FAILED",
        "两项验证已通过，但本地保存失败；可直接重试保存，不会再次调用服务商。",
      );
    }
  };

  const executeReferenceOperation = async (request: {
    current: ProviderProfile;
    operation: ProviderOperation;
    references: ProviderReference[];
    targetProfile?: ProviderProfile;
    targetModel?: DeepSeekModelId;
  }): Promise<ProviderProfileSummary> => {
    const completed = new Set(request.operation.completedTargets);
    const running: ProviderOperation = {
      ...request.operation,
      status: "migrating",
      safeReason: null,
      updatedAt: now(),
    };
    await input.store.putOperation(running);
    const onCommitted = async (ownerIds: readonly string[]): Promise<void> => {
      for (const ownerId of ownerIds) completed.add(ownerId);
      await input.store.putOperation({
        ...running,
        completedTargets: [...completed],
        updatedAt: now(),
      });
    };
    try {
      if (request.targetProfile === undefined) {
        await input.references.end({ references: request.references, onCommitted });
      } else {
        if (request.targetModel === undefined) {
          throw new ProviderProfileServiceError(
            "PROVIDER_MIGRATION_NOT_RETRYABLE",
            "这次迁移缺少目标模型，无法安全重试。",
          );
        }
        await input.references.migrate({
          references: request.references,
          targetProfile: request.targetProfile,
          targetModel: request.targetModel,
          onCommitted,
        });
      }
      const completedTargets = [...completed];
      await input.store.putOperation(completedOperation(running, completedTargets, now()));
      return await summarize(request.current);
    } catch (error) {
      await failOperation(input.store, {
        ...running,
        completedTargets: [...completed],
      }, "local-save-failed", now());
      throw error;
    }
  };

  return {
    async list() {
      await ensureRecovered();
      return await Promise.all((await input.store.listProfiles()).map(summarize));
    },

    async recoverInterrupted() {
      await ensureRecovered();
    },

    async create(request) {
      await ensureRecovered();
      await requireUniqueDisplayName(input.store, request.displayName);
      const profileId = allocateProfileId();
      const model = normalizeProviderModel("deepseek", request.defaultModel);
      const startedAt = now();
      const operation = createOperation({
        id: request.operationId,
        profileId,
        kind: "create",
        status: "validating",
        baseRevision: null,
        targetModels: [model],
        startedAt,
      });
      await input.store.putOperation(operation);
      try {
        await input.validator.validate({
          providerId: "deepseek",
          model,
          apiKey: request.apiKey,
          signal: request.signal,
        });
        request.signal?.throwIfAborted();
      } catch (error) {
        if (request.signal?.aborted === true) {
          await cancelOperation(input.store, operation, now());
          throw new ProviderProfileServiceError("PROVIDER_OPERATION_CANCELLED", "操作已取消。");
        }
        await failOperation(input.store, operation, classifyValidationError(error), now());
        throw error;
      }
      pendingCreateSaves.set(request.operationId, {
        operation,
        profileId,
        displayName: request.displayName,
        apiKey: request.apiKey,
        model,
        startedAt,
      });
      return await persistPendingCreate(request.operationId);
    },

    async retryCreateSave(operationId) {
      await ensureRecovered();
      return await persistPendingCreate(operationId);
    },

    async discardCreateSave(operationId) {
      const pending = pendingCreateSaves.get(operationId);
      if (pending === undefined) return;
      pendingCreateSaves.delete(operationId);
      await cancelOperation(input.store, pending.operation, now()).catch(() => undefined);
    },

    async rotateKey(request) {
      await ensureRecovered();
      const current = await requireProfile(input.store, request.profileId, request.expectedRevision);
      const startedAt = now();
      const operation = createOperation({
        id: request.operationId,
        profileId: current.id,
        kind: "rotate-key",
        status: "validating",
        baseRevision: current.revision,
        targetModels: current.verifiedModels,
        startedAt,
      });
      await input.store.putOperation(operation);
      const completedModels: DeepSeekModelId[] = [];
      try {
        for (const model of current.verifiedModels) {
          await input.validator.validate({
            providerId: current.providerId,
            model,
            apiKey: request.apiKey,
            signal: request.signal,
          });
          request.signal?.throwIfAborted();
          completedModels.push(model);
          await input.store.putOperation({
            ...operation,
            completedTargets: [...completedModels],
            updatedAt: now(),
          });
        }
        await input.store.putOperation({
          ...operation,
          status: "saving",
          completedTargets: [...completedModels],
          updatedAt: now(),
        });
        const credentialRef = await input.vault.stage(request.apiKey, now());
        try {
          const completedAt = now();
          const saved = await input.store.commitProfileOperation(rotateProviderProfile(current, {
            credentialRef,
            keySuffix: keySuffix(request.apiKey),
            validatedModels: completedModels,
            now: completedAt,
          }), current.revision, completedOperation(operation, completedModels, completedAt));
          await input.vault.remove(current.credentialRef).catch(() => undefined);
          return await summarize(saved);
        } catch (error) {
          await input.vault.remove(credentialRef).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        if (request.signal?.aborted === true) {
          await cancelOperation(input.store, operation, now());
          throw new ProviderProfileServiceError("PROVIDER_OPERATION_CANCELLED", "操作已取消。");
        }
        await failOperation(input.store, operation, classifyValidationError(error), now());
        throw error;
      }
    },

    async disable(profileId, expectedRevision) {
      await ensureRecovered();
      const current = await requireProfile(input.store, profileId, expectedRevision);
      const saved = await input.store.putProfile(normalizeProviderProfile({
        ...current,
        readiness: "disabled",
        reason: null,
        revision: current.revision + 1,
        updatedAt: now(),
      }), current.revision);
      return await summarize(saved);
    },

    async enable(request) {
      await ensureRecovered();
      const current = await requireProfile(input.store, request.profileId, request.expectedRevision);
      const operation = createOperation({
        id: request.operationId,
        profileId: current.id,
        kind: "enable",
        status: "validating",
        baseRevision: current.revision,
        targetModels: current.verifiedModels,
        startedAt: now(),
      });
      await input.store.putOperation(operation);
      const completedModels: DeepSeekModelId[] = [];
      try {
        const apiKey = await input.vault.read(current.credentialRef);
        for (const model of current.verifiedModels) {
          await input.validator.validate({
            providerId: current.providerId,
            model,
            apiKey,
            signal: request.signal,
          });
          completedModels.push(model);
        }
        request.signal?.throwIfAborted();
        const completedAt = now();
        const saved = await input.store.commitProfileOperation(normalizeProviderProfile({
          ...current,
          readiness: "ready",
          reason: null,
          revision: current.revision + 1,
          updatedAt: completedAt,
        }), current.revision, completedOperation(operation, completedModels, completedAt));
        return await summarize(saved);
      } catch (error) {
        if (request.signal?.aborted === true) {
          await cancelOperation(input.store, operation, now());
          throw new ProviderProfileServiceError("PROVIDER_OPERATION_CANCELLED", "操作已取消。");
        }
        const reason = classifyValidationError(error);
        const failure = classifyProviderFailure({
          current: current.readiness,
          reason,
          duringEnable: true,
        });
        const failedAt = now();
        const saved = await input.store.commitProfileOperation(normalizeProviderProfile({
          ...current,
          ...failure,
          revision: current.revision + 1,
          updatedAt: failedAt,
        }), current.revision, failedOperation(operation, reason, failedAt));
        return await summarize(saved);
      }
    },

    async addModel(request) {
      await ensureRecovered();
      const current = await requireProfile(input.store, request.profileId, request.expectedRevision);
      const model = normalizeProviderModel(current.providerId, request.model);
      if (current.verifiedModels.includes(model)) return await summarize(current);
      const operation = createOperation({
        id: request.operationId,
        profileId: current.id,
        kind: "add-model",
        status: "validating",
        baseRevision: current.revision,
        targetModels: [model],
        startedAt: now(),
      });
      await input.store.putOperation(operation);
      try {
        const apiKey = await input.vault.read(current.credentialRef);
        await input.validator.validate({
          providerId: current.providerId,
          model,
          apiKey,
          signal: request.signal,
        });
        request.signal?.throwIfAborted();
        const completedAt = now();
        const saved = await input.store.commitProfileOperation(normalizeProviderProfile({
          ...current,
          verifiedModels: [...current.verifiedModels, model],
          defaultModel: current.defaultModel ?? model,
          readiness: "ready",
          reason: null,
          revision: current.revision + 1,
          updatedAt: completedAt,
        }), current.revision, completedOperation(operation, [model], completedAt));
        return await summarize(saved);
      } catch (error) {
        if (request.signal?.aborted === true) {
          await cancelOperation(input.store, operation, now());
          throw new ProviderProfileServiceError("PROVIDER_OPERATION_CANCELLED", "操作已取消。");
        }
        await failOperation(input.store, operation, classifyValidationError(error), now());
        throw error;
      }
    },

    async setDefaultModel(profileId, expectedRevision, modelId) {
      await ensureRecovered();
      const current = await requireProfile(input.store, profileId, expectedRevision);
      const model = normalizeProviderModel(current.providerId, modelId);
      if (!current.verifiedModels.includes(model)) {
        throw new ProviderProfileServiceError("PROVIDER_MODEL_NOT_VERIFIED", "请先验证这个模型，再设为默认模型。");
      }
      const saved = await input.store.putProfile(normalizeProviderProfile({
        ...current,
        defaultModel: model,
        revision: current.revision + 1,
        updatedAt: now(),
      }), current.revision);
      return await summarize(saved);
    },

    async removeModel(profileId, expectedRevision, modelId) {
      await ensureRecovered();
      const current = await requireProfile(input.store, profileId, expectedRevision);
      const references = await input.references.list(profileId);
      const saved = await input.store.putProfile(
        removeVerifiedModel(current, modelId, references, now()),
        current.revision,
      );
      return await summarize(saved);
    },

    async replaceDefaultAndRemoveModel(profileId, expectedRevision, modelId, replacementDefaultModelId) {
      await ensureRecovered();
      const current = await requireProfile(input.store, profileId, expectedRevision);
      const model = normalizeProviderModel(current.providerId, modelId);
      const replacementDefaultModel = normalizeProviderModel(current.providerId, replacementDefaultModelId);
      if (current.defaultModel !== model || model === replacementDefaultModel) {
        throw new ProviderProfileServiceError("PROVIDER_MODEL_NOT_VERIFIED", "请选择另一已验证模型作为新默认模型。");
      }
      if (!current.verifiedModels.includes(replacementDefaultModel)) {
        throw new ProviderProfileServiceError("PROVIDER_MODEL_NOT_VERIFIED", "新默认模型尚未通过验证。");
      }
      const references = await input.references.list(profileId);
      const removed = removeVerifiedModel(current, model, references, now());
      const saved = await input.store.putProfile(normalizeProviderProfile({
        ...removed,
        defaultModel: replacementDefaultModel,
      }), current.revision);
      return await summarize(saved);
    },

    async rename(profileId, expectedRevision, displayName) {
      await ensureRecovered();
      const current = await requireProfile(input.store, profileId, expectedRevision);
      await requireUniqueDisplayName(input.store, displayName, current.id);
      const saved = await input.store.putProfile(normalizeProviderProfile({
        ...current,
        displayName,
        revision: current.revision + 1,
        updatedAt: now(),
      }), current.revision);
      return await summarize(saved);
    },

    async migrateReferences(request) {
      await ensureRecovered();
      const current = await requireProfile(input.store, request.profileId, request.expectedRevision);
      const target = await input.store.getProfile(request.targetProfileId);
      if (target === null || target.readiness !== "ready") {
        throw new ProviderProfileServiceError("PROVIDER_MIGRATION_TARGET_UNAVAILABLE", "请选择已就绪的目标档案。");
      }
      const targetModel = normalizeProviderModel(target.providerId, request.targetModel);
      if (!target.verifiedModels.includes(targetModel)) {
        throw new ProviderProfileServiceError("PROVIDER_MODEL_NOT_VERIFIED", "目标模型尚未通过验证。");
      }
      const references = selectCurrentReferences(
        await input.references.list(current.id),
        request.ownerIds,
      );
      if (references.some((reference) =>
        reference.profileId === target.id && reference.model === targetModel
      )) {
        throw new ProviderProfileServiceError(
          "PROVIDER_MIGRATION_TARGET_UNCHANGED",
          "目标档案和模型必须与所选引用的当前配置不同。",
        );
      }
      const operation = createOperation({
        id: request.operationId,
        profileId: current.id,
        kind: "migrate",
        status: "migrating",
        baseRevision: current.revision,
        targetModels: [targetModel],
        targetProfileId: target.id,
        targetOwnerIds: references.map((reference) => reference.ownerId),
        startedAt: now(),
      });
      return await executeReferenceOperation({
        current,
        operation,
        references,
        targetProfile: target,
        targetModel,
      });
    },

    async retryReferenceOperation(operationId) {
      await ensureRecovered();
      const operation = (await input.store.listOperations()).find((candidate) => candidate.id === operationId);
      if (operation === undefined || operation.kind !== "migrate" ||
        (operation.status !== "failed" && operation.status !== "cancelled")) {
        throw new ProviderProfileServiceError(
          "PROVIDER_MIGRATION_NOT_RETRYABLE",
          "这次迁移已经完成或缺少可恢复信息。",
        );
      }
      const targetOwnerIds = operation.targetOwnerIds ?? [];
      if (targetOwnerIds.length === 0) {
        throw new ProviderProfileServiceError(
          "PROVIDER_MIGRATION_NOT_RETRYABLE",
          "这次迁移缺少可恢复引用，无法安全重试。",
        );
      }
      const current = await input.store.getProfile(operation.profileId);
      if (current === null) {
        throw new ProviderProfileServiceError("PROVIDER_PROFILE_NOT_FOUND", "找不到迁移来源档案。");
      }
      const currentReferences = await input.references.list(current.id);
      const pendingReferences = currentReferences.filter((reference) => targetOwnerIds.includes(reference.ownerId));
      const targetProfileId = operation.targetProfileId;
      if (targetProfileId !== undefined && targetProfileId !== null) {
        const target = await input.store.getProfile(targetProfileId);
        if (target === null || target.readiness !== "ready") {
          throw new ProviderProfileServiceError("PROVIDER_MIGRATION_TARGET_UNAVAILABLE", "迁移目标档案已不可用，请重新选择目标档案。");
        }
        const targetModel = operation.targetModels[0];
        if (targetModel === undefined || !target.verifiedModels.includes(targetModel)) {
          throw new ProviderProfileServiceError("PROVIDER_MIGRATION_TARGET_UNAVAILABLE", "迁移目标模型已不可用，请重新选择目标档案。");
        }
        return await executeReferenceOperation({
          current,
          operation,
          references: pendingReferences,
          targetProfile: target,
          targetModel,
        });
      }
      return await executeReferenceOperation({
        current,
        operation,
        references: pendingReferences,
      });
    },

    async endReferences(request) {
      await ensureRecovered();
      const current = await requireProfile(input.store, request.profileId, request.expectedRevision);
      const references = selectCurrentReferences(
        await input.references.list(current.id),
        request.ownerIds,
      );
      if (references.some((reference) =>
        reference.kind !== "team-builder-draft" && reference.kind !== "resumable-session"
      )) {
        throw new ProviderProfileServiceError(
          "PROVIDER_REFERENCE_ACTION_UNSUPPORTED",
          "只有 AI 建队草稿和可恢复会话可以结束继续能力。",
        );
      }
      const operation = createOperation({
        id: request.operationId,
        profileId: current.id,
        kind: "migrate",
        status: "migrating",
        baseRevision: current.revision,
        targetModels: [],
        targetOwnerIds: references.map((reference) => reference.ownerId),
        startedAt: now(),
      });
      return await executeReferenceOperation({ current, operation, references });
    },

    async delete(profileId, expectedRevision) {
      await ensureRecovered();
      const current = await requireProfile(input.store, profileId, expectedRevision);
      const references = await input.references.list(profileId);
      if (references.length > 0) {
        throw new ProviderReferenceError(references);
      }
      const operation = createOperation({
        id: randomUUID(),
        profileId,
        kind: "delete",
        status: "deleting",
        baseRevision: current.revision,
        targetModels: [],
        startedAt: now(),
      });
      await input.store.putOperation(operation);
      try {
        const deleted = await input.store.deleteProfile(profileId, expectedRevision);
        if (!deleted) {
          throw new ProviderProfileServiceError("PROVIDER_PROFILE_NOT_FOUND", "找不到这个 AI 服务商档案。");
        }
        await input.store.putOperation(completedOperation(operation, [], now()));
      } catch (error) {
        await failOperation(input.store, operation, "local-save-failed", now());
        throw error;
      }
      await input.vault.remove(current.credentialRef).catch(() => undefined);
    },

    async recordRuntimeFailure(profileId, reason) {
      await ensureRecovered();
      if (
        reason !== "credential-unavailable"
        && reason !== "credential-invalid"
        && reason !== "provider-removed"
        && reason !== "model-removed"
        && reason !== "model-incompatible"
      ) return;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = await input.store.getProfile(profileId);
        if (current === null) return;
        const failure = classifyProviderFailure({ current: current.readiness, reason });
        if (failure.readiness === current.readiness && failure.reason === current.reason) return;
        try {
          await input.store.putProfile(normalizeProviderProfile({
            ...current,
            ...failure,
            revision: current.revision + 1,
            updatedAt: now(),
          }), current.revision);
          return;
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("revision")) throw error;
        }
      }
    },
  };
}

function isInterruptedOperation(operation: ProviderOperation): boolean {
  return operation.status === "validating"
    || operation.status === "saving"
    || operation.status === "migrating"
    || operation.status === "deleting";
}

async function inferCompletedReferenceTargets(
  operation: ProviderOperation,
  references: Pick<ProviderReferencePort, "list">,
): Promise<ProviderOperation> {
  if (operation.targetProfileId === undefined || operation.targetProfileId === null
    || operation.targetOwnerIds === undefined || operation.targetOwnerIds.length === 0) {
    return operation;
  }
  const targetModel = operation.targetModels[0];
  if (targetModel === undefined) return operation;
  try {
    const [sourceReferences, targetReferences] = await Promise.all([
      references.list(operation.profileId),
      references.list(operation.targetProfileId),
    ]);
    const sourceOwnerIds = new Set(sourceReferences.map((reference) => reference.ownerId));
    const destinationOwnerIds = new Set(targetReferences
      .filter((reference) => reference.model === targetModel)
      .map((reference) => reference.ownerId));
    const inferred = operation.targetOwnerIds.filter((ownerId) =>
      !sourceOwnerIds.has(ownerId) && destinationOwnerIds.has(ownerId)
    );
    const completedTargets = [...new Set([...operation.completedTargets, ...inferred])];
    return completedTargets.length === operation.completedTargets.length
      ? operation
      : { ...operation, completedTargets };
  } catch {
    // Recovery must still expose the durable operation if a reference reader
    // is temporarily unavailable; the next explicit retry will re-read state.
    return operation;
  }
}

function isVisibleProviderActivity(operation: ProviderOperation): boolean {
  if (operation.status !== "completed" && operation.status !== "failed" && operation.status !== "cancelled") {
    return true;
  }
  if (operation.kind !== "migrate" || (operation.status !== "failed" && operation.status !== "cancelled")) {
    return false;
  }
  const targetOwnerIds = operation.targetOwnerIds ?? [];
  return targetOwnerIds.some((ownerId) => !operation.completedTargets.includes(ownerId));
}

export class ProviderProfileServiceError extends Error {
  constructor(
    readonly code: "PROVIDER_PROFILE_NOT_FOUND" | "PROVIDER_PROFILE_REVISION_CONFLICT" | "PROVIDER_PROFILE_NAME_CONFLICT" | "PROVIDER_MODEL_NOT_VERIFIED" | "PROVIDER_OPERATION_CANCELLED" | "PROVIDER_REFERENCE_NOT_FOUND" | "PROVIDER_REFERENCE_ACTION_UNSUPPORTED" | "PROVIDER_MIGRATION_TARGET_UNAVAILABLE" | "PROVIDER_MIGRATION_TARGET_UNCHANGED" | "PROVIDER_MIGRATION_NOT_RETRYABLE" | "PROVIDER_LOCAL_SAVE_FAILED" | "PROVIDER_CREATE_SAVE_NOT_RETRYABLE",
    message: string,
  ) {
    super(message);
    this.name = "ProviderProfileServiceError";
  }
}

function selectCurrentReferences(
  current: readonly ProviderReference[],
  ownerIds: readonly string[],
): ProviderReference[] {
  const requested = [...new Set(ownerIds.map((ownerId) => ownerId.trim()).filter(Boolean))];
  if (requested.length === 0) {
    throw new ProviderProfileServiceError("PROVIDER_REFERENCE_NOT_FOUND", "请选择要处理的引用。");
  }
  const byOwnerId = new Map(current.map((reference) => [reference.ownerId, reference]));
  const selected = requested.map((ownerId) => byOwnerId.get(ownerId));
  if (selected.some((reference) => reference === undefined)) {
    throw new ProviderProfileServiceError(
      "PROVIDER_REFERENCE_NOT_FOUND",
      "引用已经变化，请刷新后重试。",
    );
  }
  return selected as ProviderReference[];
}

async function requireUniqueDisplayName(
  store: ProviderProfileStore,
  displayName: string,
  exceptProfileId?: string,
): Promise<void> {
  const normalized = displayName.trim().toLocaleLowerCase();
  if ((await store.listProfiles()).some((profile) =>
    profile.id !== exceptProfileId && profile.displayName.trim().toLocaleLowerCase() === normalized
  )) {
    throw new ProviderProfileServiceError(
      "PROVIDER_PROFILE_NAME_CONFLICT",
      "档案名称已被使用，请换一个名称。",
    );
  }
}

async function requireProfile(
  store: ProviderProfileStore,
  profileId: string,
  expectedRevision: number,
): Promise<ProviderProfile> {
  const profile = await store.getProfile(profileId);
  if (profile === null) {
    throw new ProviderProfileServiceError("PROVIDER_PROFILE_NOT_FOUND", "找不到这个 AI 服务商档案。");
  }
  if (profile.revision !== expectedRevision) {
    throw new ProviderProfileServiceError(
      "PROVIDER_PROFILE_REVISION_CONFLICT",
      "档案已在其他位置更新，请刷新后重试。",
    );
  }
  return profile;
}

function createOperation(input: {
  id: string;
  profileId: string;
  kind: ProviderOperation["kind"];
  status: ProviderOperation["status"];
  baseRevision: number | null;
  targetModels: DeepSeekModelId[];
  targetProfileId?: string | null;
  targetOwnerIds?: string[];
  startedAt: string;
}): ProviderOperation {
  if (input.id.trim().length === 0) {
    throw new Error("Provider operation id is required");
  }
  return {
    ...input,
    completedTargets: [],
    targetProfileId: input.targetProfileId,
    targetOwnerIds: input.targetOwnerIds,
    safeReason: null,
    updatedAt: input.startedAt,
  };
}

function completedOperation(
  operation: ProviderOperation,
  completedTargets: string[],
  updatedAt: string,
): ProviderOperation {
  return {
    ...operation,
    status: "completed",
    completedTargets,
    safeReason: null,
    updatedAt,
  };
}

function failedOperation(
  operation: ProviderOperation,
  safeReason: SafeProviderReason,
  updatedAt: string,
): ProviderOperation {
  return {
    ...operation,
    status: "failed",
    safeReason,
    updatedAt,
  };
}

async function failOperation(
  store: ProviderProfileStore,
  operation: ProviderOperation,
  safeReason: SafeProviderReason,
  updatedAt: string,
): Promise<void> {
  await store.putOperation({
    ...operation,
    status: "failed",
    safeReason,
    updatedAt,
  }).catch(() => undefined);
}

async function cancelOperation(
  store: ProviderProfileStore,
  operation: ProviderOperation,
  updatedAt: string,
): Promise<void> {
  await store.putOperation({
    ...operation,
    status: "cancelled",
    safeReason: null,
    updatedAt,
  }).catch(() => undefined);
}

function classifyValidationError(error: unknown): SafeProviderReason {
  if (isErrorWithCode(error)) {
    switch (error.code) {
      case "auth":
      case "credential-invalid":
      case "CREDENTIAL_DECRYPTION_FAILED":
      case "CREDENTIAL_NOT_FOUND":
        return "credential-invalid";
      case "model-unavailable":
      case "model-incompatible":
        return "model-incompatible";
      case "rate-limited":
        return "rate-limited";
      case "quota":
        return "quota";
      case "network":
        return "network";
    }
  }
  return "provider-unavailable";
}

function isErrorWithCode(value: unknown): value is { code: string } {
  return typeof value === "object" && value !== null && typeof (value as { code?: unknown }).code === "string";
}

function toSummary(
  profile: ProviderProfile,
  operation: ProviderOperation | null,
  references: readonly ProviderReference[],
): ProviderProfileSummary {
  return {
    id: profile.id,
    providerId: profile.providerId,
    providerName: PROVIDER_CATALOG[0].displayName,
    displayName: profile.displayName,
    keySuffix: profile.keySuffix,
    defaultModel: profile.defaultModel,
    verifiedModels: [...profile.verifiedModels],
    readiness: profile.readiness,
    reason: profile.reason,
    revision: profile.revision,
    updatedAt: profile.updatedAt,
    references: references.map((reference) => ({ ...reference })),
    activity: operation === null ? null : {
      id: operation.id,
      kind: operation.kind,
      status: operation.status,
      completedTargets: [...operation.completedTargets],
      targetModels: [...operation.targetModels],
      targetProfileId: operation.targetProfileId ?? null,
      targetOwnerIds: [...operation.targetOwnerIds ?? []],
    },
  };
}
