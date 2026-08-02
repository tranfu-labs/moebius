import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  BrowserWindow,
  dialog,
  type MessageBoxOptions,
  type OpenDialogOptions,
  type WebContents,
} from "electron";

import { integratedMainWindowOptions } from "./main-window-options.js";
import { installExternalNavigationGuards } from "./external-link.js";
import type { DesktopLocale } from "./language-preference-contract.js";
import type { DesktopStatusSnapshot } from "./status.js";
import { planMainWindowClose } from "./desktop-window-plan.js";

export class DesktopWindowRuntime {
  readonly #dirname: string;
  readonly #platform: NodeJS.Platform;
  readonly #status: DesktopStatusSnapshot;
  readonly #locale: () => DesktopLocale;
  readonly #isQuitting: () => boolean;
  readonly #hasRunningInstallers: () => boolean;
  readonly #requestShutdown: () => Promise<void>;
  readonly #statusTitle: () => string;
  #mainWindow: BrowserWindow | null = null;
  #statusWindow: BrowserWindow | null = null;

  constructor(input: {
    dirname: string;
    platform: NodeJS.Platform;
    status: DesktopStatusSnapshot;
    locale(): DesktopLocale;
    isQuitting(): boolean;
    hasRunningInstallers(): boolean;
    requestShutdown(): Promise<void>;
    statusTitle(): string;
  }) {
    this.#dirname = input.dirname;
    this.#platform = input.platform;
    this.#status = input.status;
    this.#locale = input.locale;
    this.#isQuitting = input.isQuitting;
    this.#hasRunningInstallers = input.hasRunningInstallers;
    this.#requestShutdown = input.requestShutdown;
    this.#statusTitle = input.statusTitle;
  }

  get mainWindow(): BrowserWindow | null {
    return this.#mainWindow;
  }

  focusMainWindow(): void {
    if (this.#mainWindow === null) {
      return;
    }
    if (this.#mainWindow.isMinimized()) {
      this.#mainWindow.restore();
    }
    this.#mainWindow.focus();
  }

  createMainWindow(): void {
    const consolePagePath = path.join(this.#dirname, "console-page", "index.html");
    this.#mainWindow = new BrowserWindow({
      width: 1180,
      height: 760,
      minWidth: 520,
      minHeight: 480,
      title: "Moebius",
      ...integratedMainWindowOptions(this.#platform),
      webPreferences: {
        preload: path.join(this.#dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.#mainWindow.on("close", (event) => {
      const closePlan = planMainWindowClose({
        isQuitting: this.#isQuitting(),
        hasRunningInstallers: this.#hasRunningInstallers(),
      });
      if (closePlan === "request-shutdown") {
        event.preventDefault();
        void this.#requestShutdown();
      }
    });
    this.#mainWindow.on("closed", () => {
      this.#mainWindow = null;
    });
    this.#mainWindow.webContents.on("did-finish-load", () => this.publishStatus());
    installExternalNavigationGuards(this.#mainWindow.webContents, pathToFileURL(consolePagePath).href);
    void this.#mainWindow.loadFile(consolePagePath, { query: { locale: this.#locale() } });
  }

  publishStatus(): void {
    this.#mainWindow?.webContents.send("status:snapshot", this.#status);
    this.#statusWindow?.webContents.send("status:snapshot", this.#status);
  }

  sendMain(channel: string, value: unknown): void {
    if (this.#mainWindow !== null && !this.#mainWindow.webContents.isDestroyed()) {
      this.#mainWindow.webContents.send(channel, value);
    }
  }

  openStatusPage(): void {
    if (this.#statusWindow !== null) {
      if (this.#statusWindow.isMinimized()) {
        this.#statusWindow.restore();
      }
      this.#statusWindow.focus();
      return;
    }
    this.#statusWindow = new BrowserWindow({
      width: 760,
      height: 560,
      minWidth: 520,
      minHeight: 420,
      title: this.#statusTitle(),
      webPreferences: {
        preload: path.join(this.#dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.#statusWindow.on("closed", () => {
      this.#statusWindow = null;
    });
    this.#statusWindow.webContents.on("did-finish-load", () => this.publishStatus());
    void this.#statusWindow.loadFile(path.join(this.#dirname, "status-page", "index.html"), {
      query: { locale: this.#locale() },
    });
  }

  async selectDirectory(options: OpenDialogOptions): Promise<string | null> {
    const result = this.#mainWindow === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(this.#mainWindow, options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  }

  async showMessageBox(options: MessageBoxOptions): Promise<number> {
    const result = this.#mainWindow === null
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(this.#mainWindow, options);
    return result.response;
  }

  getBroadcastTargets(): WebContents[] {
    return BrowserWindow.getAllWindows().map((window) => window.webContents);
  }
}
