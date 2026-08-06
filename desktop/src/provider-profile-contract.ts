import type { ProviderProfileSummary } from "./provider-profile-service.js";

export const PROVIDER_PROFILE_IPC_CHANNELS = {
  list: "provider-profiles:list",
  create: "provider-profiles:create",
  retryCreateSave: "provider-profiles:retry-create-save",
  discardCreateSave: "provider-profiles:discard-create-save",
  rotateKey: "provider-profiles:rotate-key",
  addModel: "provider-profiles:add-model",
  setDefaultModel: "provider-profiles:set-default-model",
  removeModel: "provider-profiles:remove-model",
  replaceDefaultAndRemoveModel: "provider-profiles:replace-default-and-remove-model",
  rename: "provider-profiles:rename",
  disable: "provider-profiles:disable",
  enable: "provider-profiles:enable",
  delete: "provider-profiles:delete",
  migrateReferences: "provider-profiles:migrate-references",
  retryReferenceOperation: "provider-profiles:retry-reference-operation",
  endReferences: "provider-profiles:end-references",
  cancel: "provider-profiles:cancel",
} as const;

export type ProviderProfileIpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

export type ProviderProfileListResult = ProviderProfileIpcResult<ProviderProfileSummary[]>;

export interface ProviderProfileCreateRequest {
  operationId: string;
  displayName: string;
  apiKey: string;
  defaultModel: string;
}

export interface ProviderProfileRotateKeyRequest {
  operationId: string;
  profileId: string;
  expectedRevision: number;
  apiKey: string;
}

export interface ProviderProfileRevisionRequest {
  operationId?: string;
  profileId: string;
  expectedRevision: number;
}

export interface ProviderProfileCancelRequest {
  operationId: string;
}

export type ProviderProfileCreateSaveRequest = ProviderProfileCancelRequest;

export interface ProviderProfileModelRequest extends ProviderProfileRevisionRequest {
  model: string;
}

export interface ProviderProfileReplaceDefaultAndRemoveModelRequest extends ProviderProfileModelRequest {
  replacementDefaultModel: string;
}

export interface ProviderProfileRenameRequest extends ProviderProfileRevisionRequest {
  displayName: string;
}

export interface ProviderProfileMigrateReferencesRequest extends ProviderProfileRevisionRequest {
  operationId: string;
  ownerIds: string[];
  targetProfileId: string;
  targetModel: string;
}

export interface ProviderProfileRetryReferenceOperationRequest {
  operationId: string;
}

export interface ProviderProfileEndReferencesRequest extends ProviderProfileRevisionRequest {
  operationId: string;
  ownerIds: string[];
}

export type ProviderProfileSummaryDto = ProviderProfileSummary;
