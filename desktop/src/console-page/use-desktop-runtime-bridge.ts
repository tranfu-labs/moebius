import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExecutionRegistryState, OperatorRunnerStatus, Translate } from "@moebius/console-ui";

import type { loadExecutionProfileRegistry } from "./console-api-client.js";
import type { DesktopApi } from "./desktop-api-contract.js";
import {
  decideDesktopAsyncCommit,
  decideDesktopRegistryCommit,
  decideDesktopRegistryLoad,
  planDesktopApiBaseResolution,
  planDesktopStatusUpdate,
  readDesktopApiBase,
} from "./desktop-runtime-bridge-model.js";
import { useDesktopShellActions } from "./use-desktop-shell-actions.js";

export function useDesktopRuntimeBridge(
  api: DesktopApi | undefined,
  injectedApiBase: string | undefined,
  search: string,
  loadRegistry: typeof loadExecutionProfileRegistry,
  fetch: typeof window.fetch,
  t: Translate,
) {
  const [apiBase, setApiBase] = useState<string | null>(() => readDesktopApiBase(search));
  const [executionRegistryState, setExecutionRegistryState] =
    useState<ExecutionRegistryState>({ status: "loading" });
  const [executionRegistryReload, setExecutionRegistryReload] = useState(0);
  const [attachmentCapability, setAttachmentCapability] = useState<string | null>(null);
  const [runnerStatus, setRunnerStatus] = useState<OperatorRunnerStatus>("stopped");
  const [statusError, setStatusError] = useState<string | null>(null);
  const shellActions = useDesktopShellActions(api, t);

  useEffect(() => {
    let cancelled = false;
    const resolution = planDesktopApiBaseResolution({ current: apiBase, injected: injectedApiBase });
    if (resolution.kind === "commit") setApiBase(resolution.apiBase);
    if (resolution.kind === "read-preload") {
      void api?.getLocalConsoleUrl?.().then((fromPreload) => {
        if (decideDesktopAsyncCommit(cancelled, Boolean(fromPreload)) === "commit") {
          setApiBase(fromPreload!);
        }
      });
    }
    return () => { cancelled = true; };
  }, [api, apiBase, injectedApiBase]);

  useEffect(() => {
    const load = decideDesktopRegistryLoad(apiBase);
    if (load.kind === "skip") {
      setExecutionRegistryState({ status: "loading" });
      return;
    }
    const controller = new AbortController();
    setExecutionRegistryState({ status: "loading" });
    void loadRegistry({
      apiBase: load.apiBase,
      fetch: fetch.bind(window),
      signal: controller.signal,
    }).then((registry) => {
      if (decideDesktopRegistryCommit(controller.signal.aborted) === "commit") {
        setExecutionRegistryState({ status: "ready", registry });
      }
    }).catch(() => {
      if (decideDesktopRegistryCommit(controller.signal.aborted) === "commit") {
        setExecutionRegistryState({ status: "error", message: "" });
      }
    });
    return () => controller.abort();
  }, [apiBase, executionRegistryReload, fetch, loadRegistry]);

  useEffect(() => {
    let cancelled = false;
    void api?.getLocalConsoleAttachmentCapability?.().then((capability) => {
      if (decideDesktopAsyncCommit(cancelled, true) === "commit") setAttachmentCapability(capability);
    });
    return () => { cancelled = true; };
  }, [api, apiBase]);

  useEffect(() => api?.onStatus?.((snapshot) => {
    const update = planDesktopStatusUpdate(snapshot);
    setRunnerStatus(update.runnerStatus);
    if (update.apiBase !== null) setApiBase(update.apiBase);
    if (update.error !== null) setStatusError(update.error);
  }), [api]);

  const reloadExecutionRegistry = useCallback(() => setExecutionRegistryReload((value) => value + 1), []);
  return useMemo(() => ({
    apiBase,
    executionRegistryState,
    reloadExecutionRegistry,
    attachmentCapability,
    runnerStatus,
    statusError,
    ...shellActions,
  }), [apiBase, attachmentCapability, executionRegistryState, reloadExecutionRegistry,
    runnerStatus, shellActions, statusError]);
}
