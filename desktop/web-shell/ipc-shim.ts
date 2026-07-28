interface FakeStatusSnapshot {
  runner: { status: "starting" | "running" | "stopped" | "crashed" | "error" };
  localConsole?: { status: "starting" | "running" | "error" | "stopped"; url?: string; sqlitePath?: string; error?: string };
}

interface FakeApi {
  onStatus(listener: (snapshot: FakeStatusSnapshot) => void): () => void;
  getLocalConsoleUrl(): Promise<string | null>;
  openObserver(): Promise<void>;
  openStatusPage(): Promise<void>;
  openDataRoot(): Promise<void>;
  selectProjectFolder(): Promise<string | null>;
  showInFolder(folderPath: string): Promise<void>;
}

const injected = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_LOCAL_CONSOLE_URL ?? "";

const api: FakeApi = {
  onStatus(listener) {
    queueMicrotask(() => {
      listener({
        runner: { status: "running" },
        localConsole: { status: "running", url: injected || undefined, sqlitePath: "(web-shell)" },
      });
    });
    return () => {};
  },
  async getLocalConsoleUrl() {
    return injected || null;
  },
  async openObserver() {
    console.info("[web-shell] openObserver: no-op in browser");
  },
  async openStatusPage() {
    console.info("[web-shell] openStatusPage: no-op in browser");
  },
  async openDataRoot() {
    console.info("[web-shell] openDataRoot: no-op in browser");
  },
  async selectProjectFolder() {
    const value = window.prompt("Web-shell: 贴项目文件夹绝对路径") ?? "";
    return value.trim() || null;
  },
  async showInFolder(folderPath) {
    console.info(`[web-shell] showInFolder: ${folderPath}`);
  },
};

(window as unknown as { moebius: FakeApi }).moebius = api;
