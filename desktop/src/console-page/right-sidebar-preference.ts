export const RIGHT_SIDEBAR_VISIBILITY_STORAGE_KEY = "moebius.right-sidebar.visibility";
export const RIGHT_SIDEBAR_WIDTH_STORAGE_KEY = "moebius.right-sidebar.width";
export type RightSidebarVisibilityPreference = "open" | "closed";

interface RightSidebarPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readRightSidebarVisibilityPreference(
  storage: Pick<RightSidebarPreferenceStorage, "getItem">,
): RightSidebarVisibilityPreference {
  try {
    return storage.getItem(RIGHT_SIDEBAR_VISIBILITY_STORAGE_KEY) === "open" ? "open" : "closed";
  } catch {
    return "closed";
  }
}

export function writeRightSidebarVisibilityPreference(
  storage: Pick<RightSidebarPreferenceStorage, "setItem">,
  preference: RightSidebarVisibilityPreference,
): void {
  try {
    storage.setItem(RIGHT_SIDEBAR_VISIBILITY_STORAGE_KEY, preference);
  } catch {
    // Preference persistence is best-effort; the control must remain usable.
  }
}

export function readRightSidebarWidthPreference(
  storage: Pick<RightSidebarPreferenceStorage, "getItem">,
): number | null {
  try {
    const value = storage.getItem(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY);
    if (value === null || value.trim() === "") {
      return null;
    }
    const width = Number(value);
    return Number.isFinite(width) && width > 0 ? Math.round(width) : null;
  } catch {
    return null;
  }
}

export function writeRightSidebarWidthPreference(
  storage: Pick<RightSidebarPreferenceStorage, "setItem">,
  width: number,
): void {
  if (!Number.isFinite(width) || width <= 0) return;
  try {
    storage.setItem(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Preference persistence is best-effort; resizing must remain available.
  }
}
