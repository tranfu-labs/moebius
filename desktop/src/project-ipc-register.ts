import type { IpcMain, OpenDialogOptions } from "electron";

export function registerProjectIpc(input: {
  ipcMain: Pick<IpcMain, "handle">;
  select(options: OpenDialogOptions): Promise<string | null>;
  showInFolder(path: string): void;
  openDataRoot(): Promise<void>;
  openProjectOptions(): OpenDialogOptions;
  repairProjectOptions(): OpenDialogOptions;
}): void {
  input.ipcMain.handle("project:select-folder", async () =>
    await input.select(input.openProjectOptions()));
  input.ipcMain.handle("project:select-folder-for-repair", async (_event, projectId: unknown) => {
    if (typeof projectId !== "string" || projectId.trim() === "") {
      throw new Error("project id is required for folder repair");
    }
    return input.select(input.repairProjectOptions());
  });
  input.ipcMain.handle("project:show-in-folder", (_event, folderPath: unknown) => {
    if (typeof folderPath !== "string" || folderPath.trim() === "") {
      throw new Error("project folder path is required");
    }
    input.showInFolder(folderPath);
  });
  input.ipcMain.handle("action:open-data-root", async () => await input.openDataRoot());
}
