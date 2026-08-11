import { useCallback, useEffect, useRef, useState } from "react";

import type {
  TaskReminderModalAction,
  TaskReminderSettingsController,
} from "@moebius/console-ui";
import type { DesktopApi } from "./desktop-api-contract.js";
import type { TaskReminderClickedPayload, TaskReminderReadState } from "../task-reminder-contract.js";
import type { PermissionModalState } from "../permission-modal-plan.js";
import {
  planChannelViewResult,
  planModalActionResult,
  planPermissionViewState,
  planPreviousEnabled,
  planRaceGuard,
  planRetrySaveTarget,
  planSaveCompletion,
  planSaveResultView,
  planTaskReminderApiAvailable,
  planTaskReminderStateLoaded,
} from "../task-reminder-delivery-plan.js";

const IDLE_MODAL: PermissionModalState = { open: false, phase: "idle", entries: [], saveFailed: false };

/**
 * Task reminder renderer controller: reads real preference/permission/channel state,
 * owns the save transaction (3-second foreground save with fallback), drives the
 * permission modal actions, and subscribes to notification click navigation.
 */
export function useTaskReminderController(
  api: DesktopApi | undefined,
): TaskReminderSettingsController {
  const [enabled, setEnabled] = useState(true);
  const [permission, setPermission] = useState<TaskReminderSettingsController["permission"]>("undetermined");
  const [channelAnomaly, setChannelAnomaly] = useState(false);
  const [saveStatus, setSaveStatus] = useState<TaskReminderSettingsController["saveStatus"]>("idle");
  const [saveResult, setSaveResult] = useState<"closed" | null>(null);
  const [checking, setChecking] = useState(false);
  const [channelCheckResult, setChannelCheckResult] = useState<TaskReminderSettingsController["channelCheckResult"]>(null);
  const [modal, setModal] = useState<PermissionModalState>(IDLE_MODAL);
  const [pendingClick, setPendingClick] = useState<TaskReminderClickedPayload | null>(null);
  const previousEnabledRef = useRef<boolean | null>(null);

  const refresh = useCallback(async () => {
    const availability = planTaskReminderApiAvailable(api?.readTaskReminderState !== undefined);
    if (availability.kind === "unavailable") {
      return;
    }
    const state = await api!.readTaskReminderState!().catch((): TaskReminderReadState | null => null);
    const loaded = planTaskReminderStateLoaded(state);
    if (loaded.kind === "missing") {
      return;
    }
    previousEnabledRef.current = loaded.state.enabled;
    setEnabled(loaded.state.enabled);
    setPermission(planPermissionViewState(loaded.state.permission));
    setChannelAnomaly(loaded.state.channelStatus === "anomaly");
    setModal(loaded.state.modal);
    setPendingClick(loaded.state.pendingClick);
  }, [api]);

  useEffect(() => {
    void refresh();
    const unsubscribe = api?.onTaskReminderClicked?.(() => {
      void refresh();
    });
    return unsubscribe;
  }, [api, refresh]);

  const runSaveTransaction = useCallback((target: boolean) => {
    setSaveStatus("saving");
    setSaveResult(null);
    const previous = planPreviousEnabled(previousEnabledRef.current);
    let settled = false;
    const finish = (ok: boolean): void => {
      const completion = planSaveCompletion(ok, target, previous);
      if (completion.kind === "applied") {
        setSaveStatus("idle");
        setSaveResult(planSaveResultView(target));
        previousEnabledRef.current = completion.value;
      } else {
        setSaveStatus("failed");
        setEnabled(completion.value);
        previousEnabledRef.current = completion.value;
      }
      void refresh();
    };
    const availability = planTaskReminderApiAvailable(api?.setTaskReminderEnabled !== undefined);
    if (availability.kind === "unavailable") {
      finish(false);
      return;
    }
    const timer = setTimeout(() => {
      const race = planRaceGuard(settled);
      if (race.kind === "skip") {
        return;
      }
      settled = true;
      finish(false);
    }, 3_000);
    void api!.setTaskReminderEnabled!(target).then((result) => {
      const race = planRaceGuard(settled);
      if (race.kind === "skip") {
        return;
      }
      settled = true;
      clearTimeout(timer);
      finish(result.ok);
    }).catch(() => {
      const race = planRaceGuard(settled);
      if (race.kind === "skip") {
        return;
      }
      settled = true;
      clearTimeout(timer);
      finish(false);
    });
  }, [api, refresh]);

  const onToggle = useCallback((target: boolean) => {
    setEnabled(target);
    setSaveResult(null);
    runSaveTransaction(target);
  }, [runSaveTransaction]);

  const onRetrySave = useCallback(() => {
    runSaveTransaction(planRetrySaveTarget(planPreviousEnabled(previousEnabledRef.current), enabled));
  }, [enabled, runSaveTransaction]);

  const onModalAction = useCallback((action: TaskReminderModalAction) => {
    const availability = planTaskReminderApiAvailable(api?.applyTaskReminderModalAction !== undefined);
    if (availability.kind === "unavailable") {
      return;
    }
    void api!.applyTaskReminderModalAction!(action as never).then((result) => {
      const applied = planModalActionResult(result.ok, result.state);
      if (applied.kind === "applied") {
        setModal(applied.state);
      }
      void refresh();
    });
  }, [api, refresh]);

  const onRequestPermission = useCallback(() => {
    onModalAction({ kind: "request" });
  }, [onModalAction]);

  const onOpenSystemSettings = useCallback(() => {
    const availability = planTaskReminderApiAvailable(api?.openTaskReminderSystemSettings !== undefined);
    if (availability.kind === "unavailable") {
      return;
    }
    void api!.openTaskReminderSystemSettings!();
  }, [api]);

  const onRecheckChannel = useCallback(() => {
    const availability = planTaskReminderApiAvailable(api?.recheckTaskReminderChannel !== undefined);
    if (availability.kind === "unavailable") {
      return;
    }
    setChecking(true);
    void api!.recheckTaskReminderChannel!().then((status) => {
      setChannelCheckResult(planChannelViewResult(status));
      setChannelAnomaly(status === "anomaly");
      void refresh();
    }).finally(() => setChecking(false));
  }, [api, refresh]);

  return {
    enabled,
    permission,
    channelAnomaly,
    saveStatus,
    saveResult,
    checking,
    channelCheckResult,
    modal,
    pendingClick,
    onToggle,
    onRequestPermission,
    onOpenSystemSettings,
    onRecheckChannel,
    onRetrySave,
    onModalAction,
  };
}
