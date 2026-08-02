export const SIDEBAR_VISIBILITY_STORAGE_KEY = "moebius.sidebar.visibility";

export type SidebarVisibilityPreference = "open" | "closed";

export function planSidebarVisibilityPreference(open: boolean): SidebarVisibilityPreference {
  return open ? "open" : "closed";
}

interface SidebarPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readSidebarVisibilityPreference(
  storage: Pick<SidebarPreferenceStorage, "getItem">,
): SidebarVisibilityPreference {
  try {
    return storage.getItem(SIDEBAR_VISIBILITY_STORAGE_KEY) === "closed" ? "closed" : "open";
  } catch {
    return "open";
  }
}

export function writeSidebarVisibilityPreference(
  storage: Pick<SidebarPreferenceStorage, "setItem">,
  preference: SidebarVisibilityPreference,
): void {
  try {
    storage.setItem(SIDEBAR_VISIBILITY_STORAGE_KEY, preference);
  } catch {
    // A blocked or full localStorage must not make the sidebar control unusable.
  }
}

export function isFirstRunOnboarding(
  onboardingCompleted: boolean | null,
): boolean {
  return onboardingCompleted === false;
}
