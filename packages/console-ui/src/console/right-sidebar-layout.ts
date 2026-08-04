export const RIGHT_SIDEBAR_MIN_WIDTH_PX = 480;
export const RIGHT_SIDEBAR_SPLIT_MIN_AVAILABLE_WIDTH_PX = 960;
export const RIGHT_SIDEBAR_DEFAULT_WIDTH_RATIO = 0.5;
export const RIGHT_SIDEBAR_MAX_WIDTH_RATIO = 0.75;
export const RIGHT_SIDEBAR_KEYBOARD_STEP_PX = 16;
export const RIGHT_SIDEBAR_KEYBOARD_LARGE_STEP_PX = 64;

export type RightSidebarLayout = "split" | "overlay";
export type RightSidebarResizeKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

export interface RightSidebarLayoutProjection {
  layout: RightSidebarLayout;
  width: number;
  minWidth: number;
  maxWidth: number;
}

export function projectRightSidebarLayout(
  availableWidth: number,
  widthPreference: number | null,
): RightSidebarLayoutProjection {
  const available = normalizeAvailableWidth(availableWidth);
  if (available < RIGHT_SIDEBAR_SPLIT_MIN_AVAILABLE_WIDTH_PX) {
    return {
      layout: "overlay",
      width: available,
      minWidth: available,
      maxWidth: available,
    };
  }
  const maxWidth = rightSidebarMaximumWidth(available);
  const preferredWidth = widthPreference ?? Math.round(
    available * RIGHT_SIDEBAR_DEFAULT_WIDTH_RATIO,
  );
  return {
    layout: "split",
    width: clampRightSidebarPresentedWidth(preferredWidth, available),
    minWidth: RIGHT_SIDEBAR_MIN_WIDTH_PX,
    maxWidth,
  };
}

export function rightSidebarMaximumWidth(availableWidth: number): number {
  const available = normalizeAvailableWidth(availableWidth);
  return Math.max(
    RIGHT_SIDEBAR_MIN_WIDTH_PX,
    Math.min(
      Math.round(available * RIGHT_SIDEBAR_MAX_WIDTH_RATIO),
      available - RIGHT_SIDEBAR_MIN_WIDTH_PX,
    ),
  );
}

export function clampRightSidebarPresentedWidth(
  width: number,
  availableWidth: number,
): number {
  const maxWidth = rightSidebarMaximumWidth(availableWidth);
  return Math.min(
    maxWidth,
    Math.max(RIGHT_SIDEBAR_MIN_WIDTH_PX, Math.round(width)),
  );
}

export function rightSidebarKeyboardWidth(
  currentWidth: number,
  key: RightSidebarResizeKey,
  shiftKey: boolean,
  availableWidth: number,
): number {
  const step = shiftKey
    ? RIGHT_SIDEBAR_KEYBOARD_LARGE_STEP_PX
    : RIGHT_SIDEBAR_KEYBOARD_STEP_PX;
  switch (key) {
    case "ArrowLeft":
      return clampRightSidebarPresentedWidth(currentWidth + step, availableWidth);
    case "ArrowRight":
      return clampRightSidebarPresentedWidth(currentWidth - step, availableWidth);
    case "Home":
      return RIGHT_SIDEBAR_MIN_WIDTH_PX;
    case "End":
      return rightSidebarMaximumWidth(availableWidth);
  }
}

function normalizeAvailableWidth(width: number): number {
  return Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0;
}
