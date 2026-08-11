import fs from "node:fs";
import type { Clipboard, IpcMain, OpenDialogOptions, Shell } from "electron";

import { OPEN_EXTERNAL_LINK_IPC_CHANNEL, openValidatedExternalLink } from "./external-link.js";
import { registerProjectIpc } from "./project-ipc-register.js";
import { registerSessionLogClipboardIpc, type SessionFactLogPathSource } from "./session-log-clipboard.js";
import { registerSettingsIpc, type RegisterSettingsIpcOptions } from "./settings-ipc.js";

export function registerDesktopCoreIpc(input: {
  ipcMain: IpcMain;
  clipboard: Clipboard;
  shell: Shell;
  openStatusPage(): void;
  refreshDoctor(): Promise<void>;
  getLocalConsoleUrl(): string | null;
  getAttachmentCapability(): string | null;
  getPathSource(): SessionFactLogPathSource | null;
  selectDirectory(options: OpenDialogOptions): Promise<string | null>;
  openProjectTitle(): string;
  repairProjectTitle(): string;
  selectLocationLabel(): string;
  dataRoot: string;
  getVersion(): string;
  checkForUpdates: RegisterSettingsIpcOptions["checkForUpdates"];
  readUpdateState?: RegisterSettingsIpcOptions["readUpdateState"];
  installUpdate?: RegisterSettingsIpcOptions["installUpdate"];
  readRunningTaskCount?: RegisterSettingsIpcOptions["readRunningTaskCount"];
  remindLater?: RegisterSettingsIpcOptions["remindLater"];
  skipVersion?: RegisterSettingsIpcOptions["skipVersion"];
  respondInstallConfirmation?: RegisterSettingsIpcOptions["respondInstallConfirmation"];
}): void {
  input.ipcMain.handle("action:open-status-page", async () => {
    input.openStatusPage();
    await input.refreshDoctor();
  });
  input.ipcMain.handle("local-console:get-url", async () => input.getLocalConsoleUrl());
  input.ipcMain.handle(
    "local-console:get-attachment-capability",
    async () => input.getAttachmentCapability(),
  );
  registerSessionLogClipboardIpc({
    ipcMain: input.ipcMain,
    getPathSource: input.getPathSource,
    clipboard: input.clipboard,
    access: (targetPath) => fs.promises.access(targetPath, fs.constants.R_OK),
  });
  input.ipcMain.handle(OPEN_EXTERNAL_LINK_IPC_CHANNEL, async (_event, url: unknown) =>
    openValidatedExternalLink(url, input.shell));
  registerProjectIpc({
    ipcMain: input.ipcMain,
    select: input.selectDirectory,
    showInFolder: (folderPath) => input.shell.showItemInFolder(folderPath),
    openDataRoot: async () => {
      await input.shell.openPath(input.dataRoot);
    },
    openProjectOptions: () => ({
      properties: ["openDirectory", "createDirectory"],
      title: input.openProjectTitle(),
    }),
    repairProjectOptions: () => ({
      properties: ["openDirectory"],
      title: input.repairProjectTitle(),
      buttonLabel: input.selectLocationLabel(),
    }),
  });
  registerSettingsIpc({
    ipcMain: input.ipcMain,
    getVersion: input.getVersion,
    checkForUpdates: input.checkForUpdates,
    readUpdateState: input.readUpdateState,
    installUpdate: input.installUpdate,
    readRunningTaskCount: input.readRunningTaskCount,
    remindLater: input.remindLater,
    skipVersion: input.skipVersion,
    respondInstallConfirmation: input.respondInstallConfirmation,
    clipboard: input.clipboard,
  });
}
