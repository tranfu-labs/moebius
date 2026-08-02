import type { DesktopStatusSnapshot } from "./status.js";

export function planDesktopDockIcon(input: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
}): "set" | "skip" {
  return input.platform === "darwin" && !input.isPackaged ? "set" : "skip";
}

export function planDesktopSeedStatus(input: {
  copiedFiles: number;
  skippedFiles: number;
  teamSeedStatus: "seeded" | "skipped" | "conflict";
}): DesktopStatusSnapshot["seed"] {
  return {
    status: "ok",
    copied: input.copiedFiles + (input.teamSeedStatus === "seeded" ? 1 : 0),
    skipped: input.skippedFiles + (input.teamSeedStatus === "skipped" ? 1 : 0),
  };
}
