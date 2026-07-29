import type { DesktopTranslationKey } from "../index.js";

export const en = {
  "window.statusTitle": "Moebius Status",
  "dialog.relocateTeam": "Relocate Agent team",
  "dialog.openProject": "Open local project folder",
  "dialog.repairProject": "Choose a new local folder for the project",
  "dialog.selectLocation": "Choose new location",
  "dialog.quit.stay": "Stay in the app",
  "dialog.quit.cancelInstall": "Cancel installation and quit",
  "dialog.quit.title": "CLI installation is still running",
  "dialog.quit.oneInstalling": "{cli} CLI is still being installed.",
  "dialog.quit.manyInstalling": "{clis} CLIs are still being installed.",
  "dialog.quit.detail": "Stay in Moebius until installation finishes, or cancel all installations and quit.",
  "dialog.cleanup.title": "Installation process is still stopping",
  "dialog.cleanup.message": "Moebius has not confirmed that the CLI installation process exited safely.",
  "dialog.cleanup.detail": "Moebius blocked the quit. Stay in the app and try again shortly to avoid leaving an installer in the background.",
} as const satisfies Record<DesktopTranslationKey, string>;
