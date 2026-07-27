import fs from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
  utilityProcess,
  type OpenDialogOptions,
  type UtilityProcess,
} from "electron";
import electronUpdater from "electron-updater";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../../src/local-console/server.js";
import { createSqliteLocalConsoleStore } from "../../src/local-console/store.js";
import { startObserverServer, type StartedObserverServer } from "../../src/observer/server.js";
import {
  buildSeedCopyPlan,
  executeSeedCopyPlan,
  resolveDesktopDataRoot,
  resolveDesktopInstanceUserDataPath,
} from "./data-root.js";
import { checkCodex } from "./env-doctor.js";
import { integratedMainWindowOptions } from "./main-window-options.js";
import { RunnerSupervisor, type RunnerProcess } from "./runner-supervisor.js";
import { DESKTOP_RUNNER_ARGS } from "./runner-launch.js";
import { resolveShellPath } from "./shell-path.js";
import type { DesktopStatusSnapshot } from "./status.js";
import { registerAiTeamBuilderIpc } from "./ai-team-builder-ipc.js";
import { AiTeamBuilder } from "./ai-team-builder/index.js";
import { TEAM_FILE_MANAGER_IPC_CHANNEL } from "./team-file-manager-contract.js";
import { openAgentTeamLocationInFileManager } from "./team-file-manager.js";
import { TEAM_IPC_CHANNELS } from "./team-ipc-contract.js";
import {
  addAgentTeamMember,
  createAgentTeam,
  duplicateBuiltInAgentTeam,
  duplicateAgentTeamMember,
  duplicateUserAgentTeam,
  applyAgentTeamOfficialUpdate,
  listAgentTeams,
  prepareAgentTeamOfficialUpdate,
  readAgentTeamMember,
  readAgentTeamExecutionProfile,
  restoreAgentTeamRecommendedProfile,
  saveAgentTeamExecutionProfile,
  setAgentTeamPrimaryAgent,
  trashAgentTeamMember,
  trashUserAgentTeam,
  updateAgentTeamInformation,
  writeAgentTeamMember,
} from "./team-ipc.js";
import { TEAM_REPAIR_IPC_CHANNELS } from "./team-repair-contract.js";
import {
  relocateAgentTeamRecord,
  removeAgentTeamRecord,
} from "./team-repair-ipc.js";
import { getTeamsRoot } from "./team-store.js";
import { seedBuiltInTeams } from "./team-seed.js";
import {
  listSessionAgentFiles,
  loadAgentTeamSnapshot,
  resolveSessionAgentTeamHealth,
} from "./team-runtime-binding.js";
import { TEAM_EXTERNAL_CHANGE_IPC_CHANNEL } from "./team-external-change-contract.js";
import {
  checkAgentTeamMemberExternalChange,
} from "./team-external-change.js";
import {
  TEAM_CONVERSATION_PREFERENCE_IPC_CHANNELS,
} from "./team-conversation-preference-contract.js";
import {
  readLastUsedAgentTeam,
  recordSuccessfulConversationAgentTeam,
} from "./team-conversation-preference.js";
import { decideUpdate, type ReleaseMetadata } from "./updater.js";
import {
  installExternalNavigationGuards,
  OPEN_EXTERNAL_LINK_IPC_CHANNEL,
  openValidatedExternalLink,
} from "./external-link.js";
import { registerSessionLogClipboardIpc } from "./session-log-clipboard.js";
import { registerOnboardingIpc } from "./onboarding/ipc.js";
import { ONBOARDING_IPC_CHANNELS } from "./onboarding/contract.js";
import { OnboardingCliReadinessService } from "./onboarding/cli-readiness.js";
import { OnboardingCliInstallManager } from "./onboarding/cli-installer-manager.js";
import { installerCleanupBlockedDialogOptions } from "./onboarding/shutdown-coordination.js";
import {
  LANGUAGE_PREFERENCE_IPC_CHANNELS,
  type DesktopLocale,
} from "./language-preference-contract.js";
import { createLanguagePreferenceIpcHandlers } from "./language-preference-ipc.js";
import {
  readLanguagePreference,
  saveLanguagePreference,
} from "./language-preference.js";
import { translateDesktop } from "./i18n/index.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, "..", "..");
const { autoUpdater } = electronUpdater;
const dataRoot = resolveDesktopDataRoot({
  env: process.env,
  isPackaged: app.isPackaged,
  projectRoot,
});
const instanceUserDataPath = resolveDesktopInstanceUserDataPath({
  dataRoot,
  packagedDefaultDataRoot: resolveDesktopDataRoot({
    env: {},
    isPackaged: true,
    projectRoot,
  }),
  defaultUserDataPath: app.getPath("userData"),
});
if (instanceUserDataPath !== app.getPath("userData")) {
  fs.mkdirSync(instanceUserDataPath, { recursive: true });
  app.setPath("userData", instanceUserDataPath);
}

if (!app.isPackaged && !app.commandLine.hasSwitch("remote-debugging-port")) {
  app.commandLine.appendSwitch("remote-debugging-port", "9222");
}

let mainWindow: BrowserWindow | null = null;
let statusWindow: BrowserWindow | null = null;
let observerServer: StartedObserverServer | null = null;
let localConsoleServer: StartedLocalConsoleServer | null = null;
let localConsoleAttachmentCapability: string | null = null;
let runnerSupervisor: RunnerSupervisor | null = null;
let onboardingCliInstaller: OnboardingCliInstallManager | null = null;
let isQuitting = false;
let activeLocale: DesktopLocale = "zh-CN";

const status: DesktopStatusSnapshot = {
  appVersion: app.getVersion(),
  dataRoot,
  observer: { status: "starting" },
  localConsole: { status: "starting" },
  runner: { status: "stopped", crashCount: 0, maxCrashCount: 3 },
  doctor: null,
  shellPath: null,
  seed: { status: "pending", copied: 0, skipped: 0 },
  update: null,
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    void boot();
  });
}

let shutdownPromise: Promise<void> | null = null;
let quitCoordinationPromise: Promise<void> | null = null;
let shutdownComplete = false;

app.on("before-quit", (event) => {
  if (shutdownComplete) {
    return;
  }
  event.preventDefault();
  void requestShutdown();
});

app.on("window-all-closed", () => {
  if (!isQuitting) {
    void requestShutdown();
  }
});

async function boot(): Promise<void> {
  activeLocale = await readLanguagePreference(status.dataRoot);
  registerLanguagePreferenceIpc();
  const onboardingReadiness = new OnboardingCliReadinessService();
  const teamBuilder = new AiTeamBuilder({
    dataRoot: status.dataRoot,
    resolveExecutionProfile: async () => onboardingReadiness.resolveBuilderExecutionProfile(),
  });
  onboardingCliInstaller = new OnboardingCliInstallManager({
    onInstallSucceeded: async (cli) => {
      await onboardingReadiness.check(cli);
    },
  });
  onboardingCliInstaller.subscribe((snapshot) => {
    if (mainWindow !== null && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(ONBOARDING_IPC_CHANNELS.cliInstallSnapshot, snapshot);
    }
  });
  registerAiTeamBuilderIpc({
    ipcMain,
    builder: teamBuilder,
  });

  registerOnboardingIpc({
    ipcMain,
    getDataRoot: () => status.dataRoot,
    clipboard,
    readiness: onboardingReadiness,
    installer: onboardingCliInstaller,
    teamBuilder,
  });
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(path.join(dirname, "app-icon-1024.png"));
  }
  createWindow();
  publishStatus();

  const shellPath = await resolveShellPath({
    platform: process.platform,
    currentPath: process.env.PATH,
  });
  status.shellPath = shellPath;
  process.env.PATH = shellPath.path;
  publishStatus();

  try {
    const seedRoot = resolveSeedRoot();
    const plan = await buildSeedCopyPlan({ seedRoot, dataRoot: status.dataRoot });
    await executeSeedCopyPlan(plan.operations);
    const teamSeed = await seedBuiltInTeams({
      seedTeamsRoot: app.isPackaged ? path.join(seedRoot, "teams") : path.join(projectRoot, "seeds", "teams"),
      dataRoot: status.dataRoot,
    });
    status.seed = {
      status: "ok",
      copied: plan.operations.length + (teamSeed.status === "seeded" ? 1 : 0),
      skipped: plan.skippedDestinations.length + (teamSeed.status === "skipped" ? 1 : 0),
    };
  } catch (error) {
    status.seed = { status: "error", copied: 0, skipped: 0, error: formatError(error) };
    publishStatus();
    return;
  }
  publishStatus();

  await startObserver();
  await startLocalConsole();
  startRunner();
}

function createWindow(): void {
  const consolePagePath = path.join(dirname, "console-page", "index.html");
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 520,
    minHeight: 560,
    title: "Moebius",
    ...integratedMainWindowOptions(process.platform),
    webPreferences: {
      preload: path.join(dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on("close", (event) => {
    if (
      !isQuitting
      && (onboardingCliInstaller?.getRunningClis().length ?? 0) > 0
    ) {
      event.preventDefault();
      void requestShutdown();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.on("did-finish-load", publishStatus);
  installExternalNavigationGuards(mainWindow.webContents, pathToFileURL(consolePagePath).href);
  void mainWindow.loadFile(consolePagePath, { query: { locale: activeLocale } });
}

function registerLanguagePreferenceIpc(): void {
  const handlers = createLanguagePreferenceIpcHandlers({
    getActiveLocale: () => activeLocale,
    setActiveLocale: (locale) => {
      activeLocale = locale;
    },
    persist: (locale) => saveLanguagePreference(status.dataRoot, locale),
    getBroadcastTargets: () => BrowserWindow.getAllWindows().map((window) => window.webContents),
  });
  ipcMain.handle(LANGUAGE_PREFERENCE_IPC_CHANNELS.read, () => handlers.read());
  ipcMain.handle(
    LANGUAGE_PREFERENCE_IPC_CHANNELS.save,
    (_event, candidate: unknown) => handlers.save(candidate),
  );
}

async function startObserver(): Promise<void> {
  try {
    observerServer = await startObserverServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: status.dataRoot,
    });
    status.observer = { status: "running", url: observerServer.url };
  } catch (error) {
    status.observer = { status: "error", error: formatError(error) };
  }
  publishStatus();
}

async function startLocalConsole(): Promise<void> {
  try {
    localConsoleAttachmentCapability = randomBytes(32).toString("base64url");
    const store = await createSqliteLocalConsoleStore({
      sqlitePath: path.join(status.dataRoot, ".state", "local-console.sqlite"),
      // Electron's process-wide single-instance lock above makes this main-process store
      // the only production writer for per-session fact logs under the data root.
      sessionLogRoot: path.join(status.dataRoot, "sessions"),
    });
    const findSession = async (sessionId: string) => {
      const session = (await store.listSessions()).find((candidate) => candidate.sessionId === sessionId);
      if (session === undefined) {
        throw new Error(`local console session not found: ${sessionId}`);
      }
      return session;
    };
    localConsoleServer = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: status.dataRoot,
      workdirRoot: path.join(status.dataRoot, "workdir"),
      store,
      attachmentRoot: path.join(status.dataRoot, ".state", "local-console-attachments"),
      attachmentCapability: localConsoleAttachmentCapability,
      listAgentFiles: async (sessionId) => listSessionAgentFiles({
        dataRoot: status.dataRoot,
        session: await findSession(sessionId),
      }),
      loadAgentTeamSnapshot: async (binding) => loadAgentTeamSnapshot({
        dataRoot: status.dataRoot,
        ownership: binding.ownership,
        teamId: binding.id,
      }),
      resolveAgentTeamHealth: async (session) => resolveSessionAgentTeamHealth({
        dataRoot: status.dataRoot,
        session,
      }),
    });
    status.localConsole = {
      status: "running",
      url: localConsoleServer.url,
      sqlitePath: localConsoleServer.sqlitePath,
    };
  } catch (error) {
    localConsoleAttachmentCapability = null;
    status.localConsole = { status: "error", error: formatError(error) };
  }
  publishStatus();
}

function startRunner(): void {
  const logPath = path.join(status.dataRoot, "logs", `runner-${new Date().toISOString().replace(/[:.]/gu, "-")}.log`);
  runnerSupervisor = new RunnerSupervisor({
    spawn: () => spawnRunnerProcess(logPath),
    logPath,
    onStateChange: (runnerState) => {
      status.runner = runnerState;
      publishStatus();
    },
  });
  runnerSupervisor.start();
}

function spawnRunnerProcess(logPath: string): RunnerProcess {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  const child = utilityProcess.fork(path.join(dirname, "runner-child.js"), [...DESKTOP_RUNNER_ARGS], {
    cwd: status.dataRoot,
    env: {
      ...process.env,
      // WORKDIR_ROOT 默认派生自 DATA_ROOT，故只需注入数据根，workdir 自动跟随。
      MOEBIUS_DATA_ROOT: status.dataRoot,
    },
    stdio: "pipe",
    serviceName: "moebius-runner",
  });

  child.stdout?.on("data", (chunk) => {
    logStream.write(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    logStream.write(chunk);
  });
  child.once("exit", () => {
    logStream.end();
  });

  return new ElectronRunnerProcess(child);
}

class ElectronRunnerProcess implements RunnerProcess {
  readonly pid?: number;
  private readonly child: UtilityProcess;

  constructor(child: UtilityProcess) {
    this.child = child;
    this.pid = child.pid;
  }

  onExit(listener: Parameters<RunnerProcess["onExit"]>[0]): void {
    this.child.once("exit", (exitCode) => {
      listener({ reason: "exit", exitCode, signal: null });
    });
    this.child.once("spawn", () => undefined);
  }

  terminate(): void {
    this.child.kill();
  }

  kill(): void {
    this.child.kill();
  }
}

ipcMain.handle("action:open-observer", async () => {
  if (status.observer.status === "running" && status.observer.url !== undefined) {
    await shell.openExternal(status.observer.url);
  }
});

ipcMain.handle("action:open-status-page", async () => {
  openStatusPage();
  status.doctor = null;
  publishStatus();
  status.doctor = { codex: await checkCodex() };
  publishStatus();
});

ipcMain.handle("local-console:get-url", async () => status.localConsole.url ?? null);
ipcMain.handle("local-console:get-attachment-capability", async () => localConsoleAttachmentCapability);

registerSessionLogClipboardIpc({
  ipcMain,
  getPathSource: () => localConsoleServer?.runtime ?? null,
  clipboard,
  access: (targetPath) => fs.promises.access(targetPath, fs.constants.R_OK),
});

ipcMain.handle(OPEN_EXTERNAL_LINK_IPC_CHANNEL, async (_event, url: unknown) =>
  openValidatedExternalLink(url, shell));

ipcMain.handle(TEAM_IPC_CHANNELS.list, async () => listAgentTeams({
  dataRoot: status.dataRoot,
  seedPending: status.seed.status === "pending",
}));

ipcMain.handle(TEAM_IPC_CHANNELS.create, async (_event, request: unknown) =>
  createAgentTeam(status.dataRoot, request));

ipcMain.handle(TEAM_IPC_CHANNELS.readMember, async (_event, request: unknown) =>
  readAgentTeamMember(status.dataRoot, request));

ipcMain.handle(TEAM_IPC_CHANNELS.writeMember, async (_event, request: unknown) =>
  writeAgentTeamMember(status.dataRoot, request));

ipcMain.handle(TEAM_IPC_CHANNELS.addMember, async (_event, request: unknown) =>
  addAgentTeamMember(status.dataRoot, request));

ipcMain.handle(TEAM_IPC_CHANNELS.updateInformation, async (_event, request: unknown) =>
  updateAgentTeamInformation(status.dataRoot, request));

ipcMain.handle(TEAM_IPC_CHANNELS.setPrimaryAgent, async (_event, request: unknown) =>
  setAgentTeamPrimaryAgent(status.dataRoot, request));

ipcMain.handle(TEAM_IPC_CHANNELS.duplicateBuiltIn, async (_event, request: unknown) =>
  duplicateBuiltInAgentTeam(status.dataRoot, request));

// Repair channels remain isolated from destructive team-management operations.
ipcMain.handle(TEAM_REPAIR_IPC_CHANNELS.selectRelocationFolder, async () => {
  const options: OpenDialogOptions = {
    properties: ["openDirectory"],
    title: translateDesktop(activeLocale, "dialog.relocateTeam"),
    defaultPath: getTeamsRoot(status.dataRoot),
  };
  const result = mainWindow === null
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(mainWindow, options);
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle(TEAM_REPAIR_IPC_CHANNELS.relocate, async (_event, request: unknown) =>
  relocateAgentTeamRecord(status.dataRoot, request));

ipcMain.handle(TEAM_REPAIR_IPC_CHANNELS.removeRecord, async (_event, request: unknown) =>
  removeAgentTeamRecord(status.dataRoot, request));

ipcMain.handle(TEAM_FILE_MANAGER_IPC_CHANNEL, async (_event, request: unknown) =>
  openAgentTeamLocationInFileManager({
    dataRoot: status.dataRoot,
    request,
    shell,
  }));

ipcMain.handle(TEAM_IPC_CHANNELS.duplicateUser, async (_event, request: unknown) =>
  duplicateUserAgentTeam(status.dataRoot, request));

ipcMain.handle(TEAM_IPC_CHANNELS.duplicateMember, async (_event, request: unknown) =>
  duplicateAgentTeamMember(status.dataRoot, request));

ipcMain.handle(TEAM_IPC_CHANNELS.trashMember, async (_event, request: unknown) =>
  trashAgentTeamMember(status.dataRoot, request, (targetPath) => shell.trashItem(targetPath)));

ipcMain.handle(TEAM_IPC_CHANNELS.trashUserTeam, async (_event, request: unknown) =>
  trashUserAgentTeam(status.dataRoot, request, (targetPath) => shell.trashItem(targetPath)));

ipcMain.handle(TEAM_IPC_CHANNELS.readExecutionProfile, async (_event, request: unknown) =>
  readAgentTeamExecutionProfile(status.dataRoot, request));

ipcMain.handle(TEAM_IPC_CHANNELS.saveExecutionProfile, async (_event, request: unknown) =>
  saveAgentTeamExecutionProfile(status.dataRoot, request));

ipcMain.handle(TEAM_IPC_CHANNELS.restoreRecommendedProfile, async (_event, request: unknown) =>
  restoreAgentTeamRecommendedProfile(status.dataRoot, request));

ipcMain.handle(TEAM_IPC_CHANNELS.prepareOfficialUpdate, async (_event, request: unknown) =>
  prepareAgentTeamOfficialUpdate(status.dataRoot, request));

ipcMain.handle(TEAM_IPC_CHANNELS.applyOfficialUpdate, async (_event, request: unknown) =>
  applyAgentTeamOfficialUpdate(status.dataRoot, request));

ipcMain.handle(TEAM_EXTERNAL_CHANGE_IPC_CHANNEL, async (_event, request: unknown) =>
  checkAgentTeamMemberExternalChange(status.dataRoot, request));

ipcMain.handle(TEAM_CONVERSATION_PREFERENCE_IPC_CHANNELS.readLastUsed, async () =>
  readLastUsedAgentTeam(status.dataRoot));

ipcMain.handle(TEAM_CONVERSATION_PREFERENCE_IPC_CHANNELS.recordSuccessful, async (_event, request: unknown) =>
  recordSuccessfulConversationAgentTeam(status.dataRoot, request, async (sessionId) => {
    if (localConsoleServer === null) {
      return false;
    }
    const localState = await localConsoleServer.runtime.state({ sessionId });
    return localState.selectedSession?.sessionId === sessionId;
  }));

ipcMain.handle("project:select-folder", async () => {
  const options: OpenDialogOptions = {
    properties: ["openDirectory", "createDirectory"],
    title: translateDesktop(activeLocale, "dialog.openProject"),
  };
  const result =
    mainWindow === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(mainWindow, options);
  if (result.canceled || result.filePaths[0] === undefined) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle("project:select-folder-for-repair", async (_event, projectId: unknown) => {
  if (typeof projectId !== "string" || projectId.trim() === "") {
    throw new Error("project id is required for folder repair");
  }
  const options: OpenDialogOptions = {
    properties: ["openDirectory"],
    title: translateDesktop(activeLocale, "dialog.repairProject"),
    buttonLabel: translateDesktop(activeLocale, "dialog.selectLocation"),
  };
  const result =
    mainWindow === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(mainWindow, options);
  if (result.canceled || result.filePaths[0] === undefined) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle("project:show-in-folder", (_event, folderPath: unknown) => {
  if (typeof folderPath !== "string" || folderPath.trim() === "") {
    throw new Error("project folder path is required");
  }
  shell.showItemInFolder(folderPath);
});

ipcMain.handle("action:open-data-root", async () => {
  await shell.openPath(status.dataRoot);
});

ipcMain.handle("action:check-updates", async () => {
  if (process.platform === "darwin") {
    const latestRelease = await fetchLatestDesktopRelease();
    const decision = decideUpdate({
      platform: process.platform,
      currentVersion: app.getVersion(),
      latestVersion: latestRelease?.version,
      downloadUrl: latestRelease?.url ?? "https://github.com/tranfu-labs/moebius/releases/latest",
    });
    status.update = decision;
    publishStatus();
    if (decision.action === "open-download-page") {
      await shell.openExternal(
        decision.downloadUrl ?? "https://github.com/tranfu-labs/moebius/releases/latest",
      );
    }
    return;
  }

  status.update = decideUpdate({ platform: process.platform, currentVersion: app.getVersion(), latestVersion: app.getVersion() });
  publishStatus();
  await autoUpdater.checkForUpdatesAndNotify();
});

async function shutdownAndQuit(): Promise<void> {
  if (shutdownPromise !== null) {
    return shutdownPromise;
  }
  isQuitting = true;
  shutdownPromise = (async () => {
    runnerSupervisor?.stop();
    await closeObserver();
    await closeLocalConsole();
    shutdownComplete = true;
    app.quit();
  })();
  return shutdownPromise;
}

async function requestShutdown(): Promise<void> {
  if (shutdownComplete || shutdownPromise !== null) {
    await shutdownAndQuit();
    return;
  }
  if (quitCoordinationPromise !== null) {
    return quitCoordinationPromise;
  }
  quitCoordinationPromise = (async () => {
    const running = onboardingCliInstaller?.getRunningClis() ?? [];
    if (running.length > 0) {
      const options = {
        type: "warning" as const,
        buttons: [
          translateDesktop(activeLocale, "dialog.quit.stay"),
          translateDesktop(activeLocale, "dialog.quit.cancelInstall"),
        ],
        defaultId: 0,
        cancelId: 0,
        title: translateDesktop(activeLocale, "dialog.quit.title"),
        message: running.length === 1
          ? translateDesktop(activeLocale, "dialog.quit.oneInstalling", {
              cli: running[0] === "codex" ? "Codex" : "Kimi",
            })
          : translateDesktop(activeLocale, "dialog.quit.bothInstalling"),
        detail: translateDesktop(activeLocale, "dialog.quit.detail"),
        noLink: true,
      };
      const result = mainWindow === null
        ? await dialog.showMessageBox(options)
        : await dialog.showMessageBox(mainWindow, options);
      if (result.response === 0) {
        return;
      }
      try {
        await onboardingCliInstaller?.cancelAll();
      } catch {
        const cleanupBlocked = installerCleanupBlockedDialogOptions(activeLocale);
        if (mainWindow === null) {
          await dialog.showMessageBox(cleanupBlocked);
        } else {
          await dialog.showMessageBox(mainWindow, cleanupBlocked);
        }
        return;
      }
    }
    await shutdownAndQuit();
  })().finally(() => {
    quitCoordinationPromise = null;
  });
  return quitCoordinationPromise;
}

async function closeObserver(): Promise<void> {
  if (observerServer === null) {
    return;
  }

  await new Promise<void>((resolve) => {
    observerServer?.server.close(() => resolve());
  });
  observerServer = null;
}

async function closeLocalConsole(): Promise<void> {
  if (localConsoleServer === null) {
    return;
  }
  await localConsoleServer.close();
  localConsoleServer = null;
  localConsoleAttachmentCapability = null;
  status.localConsole = { status: "stopped" };
}

function publishStatus(): void {
  mainWindow?.webContents.send("status:snapshot", status);
  statusWindow?.webContents.send("status:snapshot", status);
}

function openStatusPage(): void {
  if (statusWindow !== null) {
    if (statusWindow.isMinimized()) {
      statusWindow.restore();
    }
    statusWindow.focus();
    return;
  }
  statusWindow = new BrowserWindow({
    width: 760,
    height: 560,
    minWidth: 520,
    minHeight: 420,
    title: translateDesktop(activeLocale, "window.statusTitle"),
    webPreferences: {
      preload: path.join(dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  statusWindow.on("closed", () => {
    statusWindow = null;
  });
  statusWindow.webContents.on("did-finish-load", publishStatus);
  void statusWindow.loadFile(path.join(dirname, "status-page", "index.html"), {
    query: { locale: activeLocale },
  });
}

function resolveSeedRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "seed");
  }
  return projectRoot;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchLatestDesktopRelease(): Promise<ReleaseMetadata | null> {
  try {
    const response = await fetch("https://api.github.com/repos/tranfu-labs/moebius/releases/latest", {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "moebius-desktop",
      },
    });
    if (!response.ok) {
      return null;
    }
    const raw = await response.json() as unknown;
    if (!isReleaseResponse(raw)) {
      return null;
    }
    return {
      version: raw.tag_name.replace(/^desktop-/u, ""),
      url: raw.html_url,
    };
  } catch {
    return null;
  }
}

function isReleaseResponse(value: unknown): value is { tag_name: string; html_url: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const release = value as Partial<{ tag_name: unknown; html_url: unknown }>;
  return typeof release.tag_name === "string" && typeof release.html_url === "string";
}
