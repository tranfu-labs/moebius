import type {
  ProviderProfileCreateRequest,
  ProviderProfileIpcResult,
  ProviderProfileMigrateReferencesRequest,
  ProviderProfileRetryReferenceOperationRequest,
  ProviderProfileEndReferencesRequest,
  ProviderProfileListResult,
  ProviderProfileModelRequest,
  ProviderProfileRenameRequest,
  ProviderProfileRevisionRequest,
  ProviderProfileRotateKeyRequest,
  ProviderProfileSummaryDto,
  ProviderProfileReplaceDefaultAndRemoveModelRequest,
} from "../provider-profile-contract.js";

export interface ProviderSettingsPort {
  listProviderProfiles(): Promise<ProviderProfileListResult>;
  createProviderProfile(request: ProviderProfileCreateRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  retryCreateProviderProfileSave(request: { operationId: string }): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  discardCreateProviderProfileSave(request: { operationId: string }): Promise<ProviderProfileIpcResult<null>>;
  rotateProviderProfileKey(request: ProviderProfileRotateKeyRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  addProviderProfileModel(request: ProviderProfileModelRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  setProviderProfileDefaultModel(request: ProviderProfileModelRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  removeProviderProfileModel(request: ProviderProfileModelRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  replaceProviderProfileDefaultAndRemoveModel(request: ProviderProfileReplaceDefaultAndRemoveModelRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  renameProviderProfile(request: ProviderProfileRenameRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  disableProviderProfile(request: ProviderProfileRevisionRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  enableProviderProfile(request: ProviderProfileRevisionRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  deleteProviderProfile(request: ProviderProfileRevisionRequest): Promise<ProviderProfileIpcResult<null>>;
  migrateProviderProfileReferences(request: ProviderProfileMigrateReferencesRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  retryProviderProfileReferenceOperation(request: ProviderProfileRetryReferenceOperationRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  endProviderProfileReferences(request: ProviderProfileEndReferencesRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  cancelProviderProfileOperation(request: { operationId: string }): Promise<ProviderProfileIpcResult<null>>;
}

type ProviderSettingsPortCandidate = Partial<ProviderSettingsPort>;

export function hasProviderSettingsPort(api: ProviderSettingsPortCandidate | undefined): api is ProviderSettingsPort {
  return api?.listProviderProfiles !== undefined
    && api.createProviderProfile !== undefined
    && api.retryCreateProviderProfileSave !== undefined
    && api.discardCreateProviderProfileSave !== undefined
    && api.rotateProviderProfileKey !== undefined
    && api.addProviderProfileModel !== undefined
    && api.setProviderProfileDefaultModel !== undefined
    && api.removeProviderProfileModel !== undefined
    && api.replaceProviderProfileDefaultAndRemoveModel !== undefined
    && api.renameProviderProfile !== undefined
    && api.disableProviderProfile !== undefined
    && api.enableProviderProfile !== undefined
    && api.deleteProviderProfile !== undefined
    && api.migrateProviderProfileReferences !== undefined
    && api.retryProviderProfileReferenceOperation !== undefined
    && api.endProviderProfileReferences !== undefined
    && api.cancelProviderProfileOperation !== undefined;
}
