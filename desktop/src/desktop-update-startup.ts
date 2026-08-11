import type {
  DesktopUpdateProvider,
  DesktopUpdateReadyStore,
  DesktopUpdateSkipStore,
} from "./desktop-update-contract.js";
import {
  planReadyMarker,
  planReadyMarkerVersion,
  planStartupAdmission,
} from "./desktop-update-plan.js";

export interface DesktopUpdateStartupInput {
  started: boolean;
  isSupportedTarget: boolean;
  currentVersion: string;
  provider: DesktopUpdateProvider;
  readyStore: DesktopUpdateReadyStore;
  skipStore?: DesktopUpdateSkipStore;
  skippedVersion: string | null;
  onReady(version: string, skippedVersion: string | null): void;
  check(): Promise<unknown>;
}

export interface DesktopUpdateStartupResult {
  started: boolean;
  skippedVersion: string | null;
}

export async function startDesktopUpdateRuntime(
  input: DesktopUpdateStartupInput,
): Promise<DesktopUpdateStartupResult> {
  if (planStartupAdmission(input.started) === "skip") {
    return { started: input.started, skippedVersion: input.skippedVersion };
  }
  const started = true;
  if (!input.isSupportedTarget) {
    return { started, skippedVersion: null };
  }
  input.provider.autoDownload = true;
  input.provider.autoInstallOnAppQuit = false;
  const skipped = await input.skipStore?.read().catch(() => null);
  const skippedVersion = skipped?.version ?? null;
  const ready = await input.readyStore.read().catch(() => null);
  const readyPlan = planReadyMarker(ready, input.currentVersion);
  const restoredVersion = planReadyMarkerVersion(ready, input.currentVersion);
  if (restoredVersion !== undefined) {
    input.onReady(restoredVersion, skippedVersion);
    return { started, skippedVersion };
  }
  if (readyPlan === "clear") {
    await input.readyStore.clear().catch(() => undefined);
  }
  await input.check();
  return { started, skippedVersion };
}
