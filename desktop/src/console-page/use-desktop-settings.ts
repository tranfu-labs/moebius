import { useCallback, useEffect, useReducer, useRef } from "react";

import type {
  SettingsApplicationInfo,
  SettingsUpdateCheckResult,
  SettingsVersionCopyResult,
} from "../settings-contract.js";
import { SingleInFlightSettingsRequest } from "./settings-request-controller.js";
import {
  INITIAL_DESKTOP_SETTINGS_STATE,
  decideSettingsPortAvailability,
  planDesktopSettingsView,
  reduceDesktopSettings,
} from "./settings-state.js";

export interface DesktopSettingsPort {
  readApplicationInfo?: () => Promise<SettingsApplicationInfo>;
  checkForUpdates?: () => Promise<SettingsUpdateCheckResult>;
  copyVersionInfo?: () => Promise<SettingsVersionCopyResult>;
  openExternalLink?: (url: string) => Promise<void>;
}

export function useDesktopSettingsBundle(api: DesktopSettingsPort | undefined) {
  const [state, dispatch] = useReducer(
    reduceDesktopSettings,
    INITIAL_DESKTOP_SETTINGS_STATE,
  );
  const updateRequestRef = useRef(new SingleInFlightSettingsRequest());
  const copyRequestRef = useRef(new SingleInFlightSettingsRequest());
  const nextRequestIdRef = useRef(1);

  useEffect(() => {
    let active = true;
    void api?.readApplicationInfo?.().then((info) => {
      if (active) dispatch({ type: "application-info-loaded", info });
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api]);

  const onCheckSettingsUpdates = useCallback(() => {
    const requestId = nextRequestIdRef.current++;
    const currentVersion = planDesktopSettingsView(state).settingsAbout.currentVersion;
    updateRequestRef.current.start(async () => {
      const availability = decideSettingsPortAvailability(api?.checkForUpdates !== undefined);
      const result = availability.kind === "available"
        ? await api!.checkForUpdates!().catch((): SettingsUpdateCheckResult => ({
            status: "failed",
            currentVersion,
            reason: "unavailable",
          }))
        : { status: "failed", currentVersion, reason: "unavailable" } satisfies SettingsUpdateCheckResult;
      dispatch({ type: "update-finished", requestId, result });
    }, () => dispatch({ type: "update-started", requestId }));
  }, [api, state.applicationInfo?.version]);

  const onCopySettingsVersion = useCallback(() => {
    const requestId = nextRequestIdRef.current++;
    copyRequestRef.current.start(async () => {
      const availability = decideSettingsPortAvailability(api?.copyVersionInfo !== undefined);
      const result = availability.kind === "available"
        ? await api!.copyVersionInfo!().catch((): SettingsVersionCopyResult => ({
            ok: false,
            reason: "clipboard-unavailable",
          }))
        : { ok: false, reason: "clipboard-unavailable" } satisfies SettingsVersionCopyResult;
      dispatch({ type: "copy-finished", requestId, result });
    }, () => dispatch({ type: "copy-started", requestId }));
  }, [api]);

  const onOpenSettingsExternalLink = useCallback(async (url: string) => {
    const availability = decideSettingsPortAvailability(api?.openExternalLink !== undefined);
    if (availability.kind === "unavailable") {
      throw new Error("external link service unavailable");
    }
    await api!.openExternalLink!(url);
  }, [api]);

  return {
    ...planDesktopSettingsView(state),
    onCheckSettingsUpdates,
    onCopySettingsVersion,
    onOpenSettingsExternalLink,
  };
}
