import type { ProviderSettingsController, ProviderSettingsProfile } from "@moebius/console-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ProviderProfileRevisionRequest,
} from "../provider-profile-contract.js";
import { ProviderSettingsListController, type ProviderSettingsListMessages } from "./provider-settings-list-controller.js";
import { ProviderSettingsOperationController } from "./provider-settings-operation-controller.js";
import type { ProviderSettingsPort } from "./provider-settings-port.js";

export interface ProviderSettingsMessages extends ProviderSettingsListMessages {
  operationFailed: string;
}

export function useProviderSettings(
  api: ProviderSettingsPort | undefined,
  messages: ProviderSettingsMessages,
): ProviderSettingsController {
  const [state, setState] = useState<ProviderSettingsController["state"]>({ status: "loading" });
  const [busyProfileId, setBusyProfileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingCreateSaveId, setPendingCreateSaveId] = useState<string | null>(null);
  const pendingCreateSaveRef = useRef<string | null>(null);
  pendingCreateSaveRef.current = pendingCreateSaveId;
  const apiRef = useRef(api);
  apiRef.current = api;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const listRef = useRef<ProviderSettingsListController | null>(null);
  const operationRef = useRef<ProviderSettingsOperationController | null>(null);
  listRef.current ??= new ProviderSettingsListController(() => apiRef.current, setState, () => messagesRef.current);
  operationRef.current ??= new ProviderSettingsOperationController(
    () => apiRef.current,
    listRef.current,
    setBusyProfileId,
    setError,
    () => messagesRef.current.operationFailed,
  );
  const refresh = useCallback(() => listRef.current?.refresh(), []);

  useEffect(() => {
    listRef.current?.mount();
    operationRef.current?.mount();
    refresh();
    return () => {
      const pendingOperationId = pendingCreateSaveRef.current;
      if (pendingOperationId !== null) {
        void apiRef.current?.discardCreateProviderProfileSave({ operationId: pendingOperationId });
      }
      listRef.current?.unmount();
      operationRef.current?.unmount();
    };
  }, [refresh]);

  const run = useCallback(ProviderSettingsOperationController.prototype.run.bind(operationRef.current!), []);
  const runCancellable = useCallback(ProviderSettingsOperationController.prototype.runCancellable.bind(operationRef.current!), []);
  const discardCreateSave = useCallback(() => {
    const operationId = pendingCreateSaveRef.current;
    if (operationId === null) return;
    pendingCreateSaveRef.current = null;
    setPendingCreateSaveId(null);
    void apiRef.current?.discardCreateProviderProfileSave({ operationId });
  }, []);

  return useMemo(() => ({
    state,
    busyProfileId,
    error,
    canRetryCreateSave: pendingCreateSaveId !== null,
    refresh,
    create: async (input) => {
      discardCreateSave();
      const operationId = globalThis.crypto.randomUUID();
      const result = await operationRef.current!.runCancellableResult("new", operationId, async () => await requireProviderApi(apiRef.current).createProviderProfile({
        operationId,
        ...input,
      }));
      if (!result.ok && result.code === "PROVIDER_LOCAL_SAVE_FAILED") {
        pendingCreateSaveRef.current = operationId;
        setPendingCreateSaveId(operationId);
      }
      return result.ok;
    },
    retryCreateSave: async () => {
      const operationId = pendingCreateSaveRef.current;
      if (operationId === null) return false;
      const saved = await run("new", async () => await requireProviderApi(apiRef.current).retryCreateProviderProfileSave({ operationId }));
      if (saved) {
        pendingCreateSaveRef.current = null;
        setPendingCreateSaveId(null);
      }
      return saved;
    },
    discardCreateSave,
    rotateKey: async (profile, apiKey) => await runCancellable(profile.id, async (operationId) => await requireProviderApi(apiRef.current).rotateProviderProfileKey({
      operationId,
      profileId: profile.id,
      expectedRevision: profile.revision,
      apiKey,
    })),
    addModel: async (profile, model) => await runCancellable(profile.id, async (operationId) => await requireProviderApi(apiRef.current).addProviderProfileModel({
      ...revisionRequest(profile), operationId, model,
    })),
    setDefaultModel: async (profile, model) => await run(profile.id, async () => await requireProviderApi(apiRef.current).setProviderProfileDefaultModel({
      ...revisionRequest(profile), model,
    })),
    removeModel: async (profile, model) => await run(profile.id, async () => await requireProviderApi(apiRef.current).removeProviderProfileModel({
      ...revisionRequest(profile), model,
    })),
    replaceDefaultAndRemoveModel: async (profile, model, replacementDefaultModel) => await run(profile.id, async () => await requireProviderApi(apiRef.current).replaceProviderProfileDefaultAndRemoveModel({
      ...revisionRequest(profile), model, replacementDefaultModel,
    })),
    rename: async (profile, displayName) => await run(profile.id, async () => await requireProviderApi(apiRef.current).renameProviderProfile({
      ...revisionRequest(profile), displayName,
    })),
    disable: async (profile) => { await run(profile.id, async () => await requireProviderApi(apiRef.current).disableProviderProfile(revisionRequest(profile))); },
    enable: async (profile) => { await runCancellable(profile.id, async (operationId) => await requireProviderApi(apiRef.current).enableProviderProfile({ ...revisionRequest(profile), operationId })); },
    migrateReferences: async (profile, ownerIds, targetProfileId, targetModel) => await runCancellable(profile.id, async (operationId) => await requireProviderApi(apiRef.current).migrateProviderProfileReferences({
      ...revisionRequest(profile), operationId, ownerIds, targetProfileId, targetModel,
    })),
    retryReferenceOperation: async (profile, operationId) => (await operationRef.current!.runCancellableResult(profile.id, operationId, async () => await requireProviderApi(apiRef.current).retryProviderProfileReferenceOperation({ operationId }))).ok,
    endReference: async (profile, ownerId) => await runCancellable(profile.id, async (operationId) => await requireProviderApi(apiRef.current).endProviderProfileReferences({
      ...revisionRequest(profile), operationId, ownerIds: [ownerId],
    })),
    delete: async (profile) => {
      await run(profile.id, async () => await requireProviderApi(apiRef.current).deleteProviderProfile(revisionRequest(profile)));
    },
    cancel: (profileId) => operationRef.current?.cancelBackend(profileId),
  }), [busyProfileId, discardCreateSave, error, pendingCreateSaveId, refresh, run, runCancellable, state]);
}

function requireProviderApi(api: ProviderSettingsPort | undefined): ProviderSettingsPort {
  if (api === undefined) throw new Error("provider bridge unavailable");
  return api;
}

function revisionRequest(profile: ProviderSettingsProfile): ProviderProfileRevisionRequest {
  return { profileId: profile.id, expectedRevision: profile.revision };
}
