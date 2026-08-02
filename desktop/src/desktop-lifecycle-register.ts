import type { App } from "electron";

export function registerDesktopLifecycle(input: {
  app: App;
  focusMainWindow(): void;
  boot(): Promise<void>;
  beforeQuit(preventDefault: () => void): void;
  lastWindowClosed(): void;
}): void {
  if (!input.app.requestSingleInstanceLock()) {
    input.app.quit();
  } else {
    input.app.on("second-instance", input.focusMainWindow);
    input.app.whenReady().then(() => {
      void input.boot();
    });
  }
  input.app.on("before-quit", (event) => {
    input.beforeQuit(() => event.preventDefault());
  });
  input.app.on("window-all-closed", input.lastWindowClosed);
}
