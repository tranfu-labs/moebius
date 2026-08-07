import type { IpcMain } from "electron";
import {
  PROVIDER_PROFILE_IPC_CHANNELS,
  type ProviderProfileCreateRequest,
  type ProviderProfileCancelRequest,
  type ProviderProfileIpcResult,
  type ProviderProfileMigrateReferencesRequest,
  type ProviderProfileEndReferencesRequest,
  type ProviderProfileRetryReferenceOperationRequest,
  type ProviderProfileModelRequest,
  type ProviderProfileRenameRequest,
  type ProviderProfileRevisionRequest,
  type ProviderProfileRotateKeyRequest,
  type ProviderProfileReplaceDefaultAndRemoveModelRequest,
} from "./provider-profile-contract.js";
import type { ProviderProfileService } from "./provider-profile-service.js";

export function registerProviderProfileIpc(input: {
  ipcMain: IpcMain;
  service: ProviderProfileService;
}): { getRunningTaskCount(): number; cancelAll(): void } {
  const operations = new Map<string, AbortController>();
  input.ipcMain.handle(PROVIDER_PROFILE_IPC_CHANNELS.list, () => invoke(() => input.service.list()));
  input.ipcMain.handle(PROVIDER_PROFILE_IPC_CHANNELS.create, (_event, raw: unknown) => {
    const request = readCreate(raw);
    return invokeCancelable(operations, request.operationId, (signal) => input.service.create({ ...request, signal }));
  });
  input.ipcMain.handle(PROVIDER_PROFILE_IPC_CHANNELS.retryCreateSave, (_event, raw: unknown) => {
    const request = readCancel(raw);
    return invoke(() => input.service.retryCreateSave(request.operationId));
  });
  input.ipcMain.handle(PROVIDER_PROFILE_IPC_CHANNELS.discardCreateSave, (_event, raw: unknown) => {
    const request = readCancel(raw);
    return invoke(async () => {
      await input.service.discardCreateSave(request.operationId);
      return null;
    });
  });
  input.ipcMain.handle(PROVIDER_PROFILE_IPC_CHANNELS.rotateKey, (_event, raw: unknown) => {
    const request = readRotate(raw);
    return invokeCancelable(operations, request.operationId, (signal) => input.service.rotateKey({ ...request, signal }));
  });
  input.ipcMain.handle(PROVIDER_PROFILE_IPC_CHANNELS.addModel, (_event, raw: unknown) => {
    const request = readModelRequest(raw, true);
    return invokeCancelable(operations, request.operationId!, (signal) => input.service.addModel({ ...request, operationId: request.operationId!, signal }));
  });
  input.ipcMain.handle(PROVIDER_PROFILE_IPC_CHANNELS.setDefaultModel, (_event, raw: unknown) => {
    const request = readModelRequest(raw, false);
    return invoke(() => input.service.setDefaultModel(request.profileId, request.expectedRevision, request.model));
  });
  input.ipcMain.handle(PROVIDER_PROFILE_IPC_CHANNELS.removeModel, (_event, raw: unknown) => {
    const request = readModelRequest(raw, false);
    return invoke(() => input.service.removeModel(request.profileId, request.expectedRevision, request.model));
  });
  input.ipcMain.handle(PROVIDER_PROFILE_IPC_CHANNELS.replaceDefaultAndRemoveModel, (_event, raw: unknown) => {
    const request = readReplaceDefaultAndRemoveModel(raw);
    return invoke(() => input.service.replaceDefaultAndRemoveModel(
      request.profileId,
      request.expectedRevision,
      request.model,
      request.replacementDefaultModel,
    ));
  });
  input.ipcMain.handle(PROVIDER_PROFILE_IPC_CHANNELS.rename, (_event, raw: unknown) => {
    const request = readRename(raw);
    return invoke(() => input.service.rename(request.profileId, request.expectedRevision, request.displayName));
  });
  input.ipcMain.handle(PROVIDER_PROFILE_IPC_CHANNELS.disable, (_event, raw: unknown) => {
    const request = readRevision(raw, false);
    return invoke(() => input.service.disable(request.profileId, request.expectedRevision));
  });
  input.ipcMain.handle(PROVIDER_PROFILE_IPC_CHANNELS.enable, (_event, raw: unknown) => {
    const request = readRevision(raw, true);
    return invokeCancelable(operations, request.operationId!, (signal) => input.service.enable({
      operationId: request.operationId!,
      profileId: request.profileId,
      expectedRevision: request.expectedRevision,
      signal,
    }));
  });
  input.ipcMain.handle(PROVIDER_PROFILE_IPC_CHANNELS.delete, (_event, raw: unknown) => {
    const request = readRevision(raw, false);
    return invoke(async () => {
      await input.service.delete(request.profileId, request.expectedRevision);
      return null;
    });
  });
  input.ipcMain.handle(PROVIDER_PROFILE_IPC_CHANNELS.migrateReferences, (_event, raw: unknown) => {
    const request = readMigrateReferences(raw);
    return invokeCancelable(operations, request.operationId, () => input.service.migrateReferences(request));
  });
  input.ipcMain.handle(PROVIDER_PROFILE_IPC_CHANNELS.retryReferenceOperation, (_event, raw: unknown) => {
    const request = readRetryReferenceOperation(raw);
    return invokeCancelable(operations, request.operationId, () => input.service.retryReferenceOperation(request.operationId));
  });
  input.ipcMain.handle(PROVIDER_PROFILE_IPC_CHANNELS.endReferences, (_event, raw: unknown) => {
    const request = readEndReferences(raw);
    return invokeCancelable(operations, request.operationId, () => input.service.endReferences(request));
  });
  input.ipcMain.handle(PROVIDER_PROFILE_IPC_CHANNELS.cancel, (_event, raw: unknown) => {
    const request = readCancel(raw);
    operations.get(request.operationId)?.abort();
    return { ok: true, value: null } satisfies ProviderProfileIpcResult<null>;
  });
  return {
    getRunningTaskCount: () => operations.size,
    cancelAll: () => {
      for (const controller of operations.values()) controller.abort();
    },
  };
}

async function invokeCancelable<T>(
  operations: Map<string, AbortController>,
  operationId: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<ProviderProfileIpcResult<T>> {
  if (operations.has(operationId)) {
    return { ok: false, code: "PROVIDER_OPERATION_DUPLICATE", message: "这个操作已在进行中。" };
  }
  const controller = new AbortController();
  operations.set(operationId, controller);
  try {
    return await invoke(() => operation(controller.signal));
  } finally {
    if (operations.get(operationId) === controller) operations.delete(operationId);
  }
}

async function invoke<T>(operation: () => Promise<T>): Promise<ProviderProfileIpcResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return {
      ok: false,
      code: readErrorCode(error),
      message: error instanceof Error ? error.message : "AI 服务商操作失败。",
    };
  }
}

function readCreate(value: unknown): ProviderProfileCreateRequest {
  const record = readRecord(value);
  return {
    operationId: readString(record.operationId, "operationId"),
    displayName: readString(record.displayName, "displayName"),
    apiKey: readString(record.apiKey, "apiKey"),
    defaultModel: readString(record.defaultModel, "defaultModel"),
  };
}

function readCancel(value: unknown): ProviderProfileCancelRequest {
  const record = readRecord(value);
  return { operationId: readString(record.operationId, "operationId") };
}

function readRotate(value: unknown): ProviderProfileRotateKeyRequest {
  const record = readRecord(value);
  return {
    operationId: readString(record.operationId, "operationId"),
    profileId: readString(record.profileId, "profileId"),
    expectedRevision: readRevisionNumber(record.expectedRevision),
    apiKey: readString(record.apiKey, "apiKey"),
  };
}

function readRevision(value: unknown, requireOperationId: boolean): ProviderProfileRevisionRequest {
  const record = readRecord(value);
  return {
    ...(requireOperationId ? { operationId: readString(record.operationId, "operationId") } : {}),
    profileId: readString(record.profileId, "profileId"),
    expectedRevision: readRevisionNumber(record.expectedRevision),
  };
}

function readModelRequest(value: unknown, requireOperationId: boolean): ProviderProfileModelRequest {
  const record = readRecord(value);
  return {
    ...readRevision(value, requireOperationId),
    model: readString(record.model, "model"),
  };
}

function readReplaceDefaultAndRemoveModel(value: unknown): ProviderProfileReplaceDefaultAndRemoveModelRequest {
  const record = readRecord(value);
  return {
    ...readModelRequest(value, false),
    replacementDefaultModel: readString(record.replacementDefaultModel, "replacementDefaultModel"),
  };
}

function readRename(value: unknown): ProviderProfileRenameRequest {
  const record = readRecord(value);
  return {
    ...readRevision(value, false),
    displayName: readString(record.displayName, "displayName"),
  };
}

function readMigrateReferences(value: unknown): ProviderProfileMigrateReferencesRequest {
  const record = readRecord(value);
  return {
    ...readRevision(value, true),
    operationId: readString(record.operationId, "operationId"),
    ownerIds: readStringArray(record.ownerIds, "ownerIds"),
    targetProfileId: readString(record.targetProfileId, "targetProfileId"),
    targetModel: readString(record.targetModel, "targetModel"),
  };
}

function readEndReferences(value: unknown): ProviderProfileEndReferencesRequest {
  const record = readRecord(value);
  return {
    ...readRevision(value, true),
    operationId: readString(record.operationId, "operationId"),
    ownerIds: readStringArray(record.ownerIds, "ownerIds"),
  };
}

function readRetryReferenceOperation(value: unknown): ProviderProfileRetryReferenceOperationRequest {
  const record = readRecord(value);
  return { operationId: readString(record.operationId, "operationId") };
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("请求格式无效。");
  return value as Record<string, unknown>;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 16_384 || /[\r\n\0]/u.test(value)) {
    throw new Error(`${field} 无效。`);
  }
  return value.trim();
}

function readRevisionNumber(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error("档案版本无效。");
  return value as number;
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1_000) {
    throw new Error(`${field} 无效。`);
  }
  return [...new Set(value.map((item) => readString(item, field)))];
}

function readErrorCode(value: unknown): string {
  return typeof value === "object" && value !== null && "code" in value && typeof value.code === "string"
    ? value.code
    : "PROVIDER_OPERATION_FAILED";
}
