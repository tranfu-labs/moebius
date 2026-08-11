import { useCallback, useEffect, useReducer, useRef } from "react";

import type {
  SettingsInstallConfirmation,
  SettingsInstallFailure,
  SettingsApplicationInfo,
  SettingsUpdateCheckResult,
  SettingsVersionCopyResult,
} from "../settings-contract.js";
import type { AgentExecutionProfile } from "@moebius/console-ui";
import { SingleInFlightSettingsRequest } from "./settings-request-controller.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";
import {
  INITIAL_DESKTOP_SETTINGS_STATE,
  decideSettingsPortAvailability,
  planDesktopSettingsView,
  reduceDesktopSettings,
} from "./settings-state.js";

export interface DesktopSettingsPort {
  readApplicationInfo?: () => Promise<SettingsApplicationInfo>;
  checkForUpdates?: () => Promise<SettingsUpdateCheckResult>;
  readUpdateState?: () => Promise<SettingsUpdateCheckResult>;
  onUpdateState?: (listener: (state: SettingsUpdateCheckResult) => void) => () => void;
  installUpdate?: () => Promise<void>;
  readRunningTaskCount?: () => Promise<number>;
  remindLater?: () => Promise<SettingsUpdateCheckResult>;
  skipVersion?: () => Promise<SettingsUpdateCheckResult>;
  onInstallConfirmation?: (listener: (confirmation: SettingsInstallConfirmation) => void) => () => void;
  onInstallFailure?: (listener: (failure: SettingsInstallFailure) => void) => () => void;
  respondInstallConfirmation?: (requestId: number, approved: boolean) => Promise<void>;
  copyVersionInfo?: () => Promise<SettingsVersionCopyResult>;
  openExternalLink?: (url: string) => Promise<void>;
  getDefaultAgent?: () => Promise<{ profile: AgentExecutionProfile; saved: boolean }>;
  saveDefaultAgent?: (request: { profile: AgentExecutionProfile }) => Promise<{ profile: AgentExecutionProfile; saved: boolean }>;
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
    const dispatchIfActive = (action: Parameters<typeof dispatch>[0]): void => {
      if (active) dispatch(action);
    };
    void api?.readApplicationInfo?.().then((info) => {
      dispatchIfActive({ type: "application-info-loaded", info });
    }).catch(() => undefined);
    void api?.readUpdateState?.().then((state) => {
      dispatchIfActive({ type: "update-state-received", state });
    }).catch(() => undefined);
    void api?.getDefaultAgent?.().then(({ profile }) => {
      dispatchIfActive({ type: "default-agent-loaded", profile });
    }).catch(() => undefined);
    const unsubscribe = api?.onUpdateState?.((state) => {
      dispatchIfActive({ type: "update-state-received", state });
    });
    const unsubscribeConfirmation = api?.onInstallConfirmation?.((confirmation) => {
      dispatchIfActive({ type: "install-confirmation-received", confirmation });
    });
    const unsubscribeFailure = api?.onInstallFailure?.((failure) => {
      dispatchIfActive({ type: "install-failure-received", failure });
    });
    const readTaskCount = () => {
      void api?.readRunningTaskCount?.().then((count) => {
        dispatchIfActive({ type: "running-task-count-received", count });
      }).catch(() => undefined);
    };
    readTaskCount();
    const taskCountTimer = window.setInterval(readTaskCount, 500);
    return () => {
      active = false;
      unsubscribe?.();
      unsubscribeConfirmation?.();
      unsubscribeFailure?.();
      window.clearInterval(taskCountTimer);
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

  const onInstallUpdate = useCallback(async () => {
    const availability = decideSettingsPortAvailability(api?.installUpdate !== undefined);
    if (availability.kind === "unavailable") {
      throw new Error("update installation service unavailable");
    }
    await api!.installUpdate!();
  }, [api]);

  const onSaveDefaultAgent = useCallback(async (profile: AgentExecutionProfile) => {
    const availability = decideSettingsPortAvailability(api?.saveDefaultAgent !== undefined);
    if (availability.kind === "unavailable") {
      dispatch({ type: "default-agent-save-failed", error: "default agent service unavailable" });
      return;
    }
    dispatch({ type: "default-agent-save-started" });
    try {
      const response = await api!.saveDefaultAgent!({ profile });
      dispatch({ type: "default-agent-save-finished", profile: response.profile });
    } catch (error) {
      dispatch({
        type: "default-agent-save-failed",
        error: planConsoleErrorMessage(error),
      });
    }
  }, [api]);

  const onRemindLaterUpdate = useCallback(async () => {
    const availability = decideSettingsPortAvailability(api?.remindLater !== undefined);
    if (availability.kind === "unavailable") return;
    const state = await api!.remindLater!().catch(() => null);
    if (state !== null) dispatch({ type: "update-state-received", state });
  }, [api]);

  const onSkipUpdate = useCallback(async () => {
    const availability = decideSettingsPortAvailability(api?.skipVersion !== undefined);
    if (availability.kind === "unavailable") return;
    const state = await api!.skipVersion!().catch(() => null);
    if (state !== null) dispatch({ type: "update-state-received", state });
  }, [api]);

  const onInstallConfirmationDecision = useCallback((requestId: number, approved: boolean) => {
    dispatch({ type: "install-confirmation-cleared", requestId });
    void api?.respondInstallConfirmation?.(requestId, approved).catch(() => undefined);
  }, [api]);

  const onInstallFailureDecision = useCallback((decision: "dismiss" | "retry") => {
    dispatch({ type: "install-failure-cleared" });
    if (decision === "retry") {
      void onInstallUpdate().catch(() => undefined);
    }
  }, [onInstallUpdate]);

  return {
    ...planDesktopSettingsView(state),
    onCheckSettingsUpdates,
    onCopySettingsVersion,
    onOpenSettingsExternalLink,
    onInstallUpdate,
    onSaveDefaultAgent,
    onRemindLaterUpdate,
    onSkipUpdate,
    onInstallConfirmationDecision,
    onInstallFailureDecision,
    runningTaskCount: state.runningTaskCount,
    installConfirmation: state.installConfirmation,
    installFailure: state.installFailure,
    remindLaterVersion: state.remindLaterVersion,
  };
}
