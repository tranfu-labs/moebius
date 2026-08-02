import fs from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  clipboard,
  ipcMain,
  shell,
} from "electron";
import { startLocalConsoleServer } from "../../src/local-console/start.js";
import { createSqliteLocalConsoleStore } from "../../src/local-console/store.js";
import { closeSqliteStateWorkers } from "../../src/sqlite-state.js";
import {
  buildSeedCopyPlan,
  executeSeedCopyPlan,
  resolveDesktopDataRoot,
  resolveDesktopInstanceUserDataPath,
} from "./data-root.js";
import { checkCodex } from "./env-doctor.js";
import { DesktopWindowRuntime } from "./desktop-window-runtime.js";
import { DesktopLocalConsoleRuntime } from "./desktop-local-console-runtime.js";
import { DesktopShutdownRuntime } from "./desktop-shutdown-runtime.js";
import { runDesktopStartup } from "./desktop-startup-runtime.js";
import { createShellPathReadinessGate, resolveShellPath } from "./shell-path.js";
import type { DesktopStatusSnapshot } from "./status.js";
import { registerAiTeamBuilderIpc } from "./ai-team-builder-ipc.js";
import { AiTeamBuilder } from "./ai-team-builder/index.js";
import { createAgentTeamService } from "./team-ipc.js";
import { registerTeamIpc } from "./team-ipc-register.js";
import { seedBuiltInTeams } from "./team-seed.js";
import {
  createTeamRuntimeBindingService,
} from "./team-runtime-binding.js";
import {
  createTeamConversationPreferenceService,
} from "./team-conversation-preference.js";
import { registerProjectIpc } from "./project-ipc-register.js";
import {
  createDesktopAgentTeamServicePorts,
  createDesktopTeamConversationPreferencePorts,
  createDesktopTeamRuntimeBindingPorts,
} from "./desktop-team-wiring.js";
import { createDesktopTeamIpcOptions } from "./desktop-team-ipc-wiring.js";
import { checkDesktopUpdates, fetchLatestDesktopRelease } from "./updater.js";
import { registerSettingsIpc } from "./settings-ipc.js";
import {
  OPEN_EXTERNAL_LINK_IPC_CHANNEL,
  openValidatedExternalLink,
} from "./external-link.js";
import { registerSessionLogClipboardIpc } from "./session-log-clipboard.js";
import { registerOnboardingIpc } from "./onboarding/register.js";
import { ONBOARDING_IPC_CHANNELS } from "./onboarding/contract.js";
import { OnboardingCliReadinessService } from "./onboarding/cli-readiness.js";
import { OnboardingCliInstallManager } from "./onboarding/cli-installer-manager.js";
import {
  installerCleanupBlockedDialogOptions,
  installerQuitDialogOptions,
} from "./onboarding/shutdown-coordination.js";
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

const teamRuntimeBinding = createTeamRuntimeBindingService(
  createDesktopTeamRuntimeBindingPorts(),
);
const agentTeamService = createAgentTeamService(
  createDesktopAgentTeamServicePorts(),
);
let onboardingCliInstaller: OnboardingCliInstallManager | null = null;
let activeLocale: DesktopLocale = "zh-CN";
let shutdown!: DesktopShutdownRuntime;

const status: DesktopStatusSnapshot = {
  appVersion: app.getVersion(),
  dataRoot,
  localConsole: { status: "starting" },
  doctor: null,
  shellPath: null,
  seed: { status: "pending", copied: 0, skipped: 0 },
  update: null,
};

const windows = new DesktopWindowRuntime({
  dirname,
  platform: process.platform,
  status,
  locale: () => activeLocale,
  isQuitting: () => shutdown.isQuitting,
  hasRunningInstallers: () => (onboardingCliInstaller?.getRunningClis().length ?? 0) > 0,
  requestShutdown: () => shutdown.request(),
  statusTitle: () => translateDesktop(activeLocale, "window.statusTitle"),
});

const localConsole = new DesktopLocalConsoleRuntime({
  status,
  paths: {
    dataRoot: status.dataRoot,
    sqlitePath: path.join(status.dataRoot, ".state", "local-console.sqlite"),
    sessionLogRoot: path.join(status.dataRoot, "sessions"),
    workdirRoot: path.join(status.dataRoot, "workdir"),
    attachmentRoot: path.join(status.dataRoot, ".state", "local-console-attachments"),
  },
  createStore: () => createSqliteLocalConsoleStore({
    sqlitePath: path.join(status.dataRoot, ".state", "local-console.sqlite"),
    sessionLogRoot: path.join(status.dataRoot, "sessions"),
  }),
  startServer: startLocalConsoleServer,
  createCapability: () => randomBytes(32).toString("base64url"),
  createTeamOptions: (findSession) => ({
    listAgentFiles: async (sessionId) => teamRuntimeBinding.listSessionAgentFiles({
      dataRoot: status.dataRoot,
      session: await findSession(sessionId),
    }),
    loadAgentTeamSnapshot: async (binding) => teamRuntimeBinding.loadAgentTeamSnapshot({
      dataRoot: status.dataRoot,
      ownership: binding.ownership,
      teamId: binding.id,
    }),
    resolveAgentTeamHealth: async (session) => teamRuntimeBinding.resolveSessionAgentTeamHealth({
      dataRoot: status.dataRoot,
      session,
    }),
  }),
  publishStatus: () => windows.publishStatus(),
  formatError,
});

shutdown = new DesktopShutdownRuntime({
  closeLocalConsole: () => localConsole.close(),
  closeStateWorkers: closeSqliteStateWorkers,
  quit: () => app.quit(),
  getRunningInstallers: () => onboardingCliInstaller?.getRunningClis() ?? [],
  confirmInstallerCancellation: async (running) => {
    const response = await windows.showMessageBox(
      installerQuitDialogOptions(running, activeLocale),
    );
    return response !== 0;
  },
  cancelInstallers: async () => {
    await onboardingCliInstaller?.cancelAll();
  },
  reportCleanupBlocked: async () => {
    await windows.showMessageBox(installerCleanupBlockedDialogOptions(activeLocale));
  },
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    windows.focusMainWindow();
  });

  app.whenReady().then(() => {
    void boot();
  });
}

app.on("before-quit", (event) => {
  shutdown.beforeQuit(() => event.preventDefault());
});

app.on("window-all-closed", () => {
  shutdown.lastWindowClosed();
});

async function boot(): Promise<void> {
  await runDesktopStartup({
    status,
    platform: process.platform,
    isPackaged: app.isPackaged,
    readLocale: () => readLanguagePreference(status.dataRoot),
    setLocale: (locale) => {
      activeLocale = locale;
    },
    registerLanguage: registerLanguagePreferenceIpc,
    createShellPathGate: (apply) => createShellPathReadinessGate({
      resolve: () => resolveShellPath({ platform: process.platform, currentPath: process.env.PATH }),
      apply,
    }),
    createReadiness: () => new OnboardingCliReadinessService(),
    createBuilder: (readiness, gate) => new AiTeamBuilder({
      dataRoot: status.dataRoot,
      resolveExecutionProfile: () => gate.afterReady(() => readiness.ensureBuilderExecutionProfile()),
    }),
    createInstaller: (onInstallSucceeded) => new OnboardingCliInstallManager({ onInstallSucceeded }),
    setInstaller: (installer) => {
      onboardingCliInstaller = installer;
    },
    observeInstaller: (installer) => installer.subscribe((snapshot) => {
      windows.sendMain(ONBOARDING_IPC_CHANNELS.cliInstallSnapshot, snapshot);
    }),
    registerBuilder: (builder) => registerAiTeamBuilderIpc({ ipcMain, builder }),
    registerOnboarding: ({ readiness, installer, builder }) => registerOnboardingIpc({
      ipcMain,
      getDataRoot: () => status.dataRoot,
      clipboard,
      readiness,
      installer,
      teamBuilder: builder,
    }),
    setDockIcon: () => app.dock?.setIcon(path.join(dirname, "app-icon-1024.png")),
    createWindow: () => windows.createMainWindow(),
    publishStatus: () => windows.publishStatus(),
    buildSeedPlan: () => buildSeedCopyPlan({ seedRoot: resolveSeedRoot(), dataRoot: status.dataRoot }),
    executeSeedPlan: executeSeedCopyPlan,
    seedTeams: () => seedBuiltInTeams({
      seedTeamsRoot: app.isPackaged
        ? path.join(resolveSeedRoot(), "teams")
        : path.join(projectRoot, "seeds", "teams"),
      dataRoot: status.dataRoot,
    }),
    startLocalConsole: () => localConsole.start(),
    formatError,
  });
}

function registerLanguagePreferenceIpc(): void {
  const handlers = createLanguagePreferenceIpcHandlers({
    getActiveLocale: () => activeLocale,
    setActiveLocale: (locale) => {
      activeLocale = locale;
    },
    persist: (locale) => saveLanguagePreference(status.dataRoot, locale),
    getBroadcastTargets: () => windows.getBroadcastTargets(),
  });
  ipcMain.handle(LANGUAGE_PREFERENCE_IPC_CHANNELS.read, () => handlers.read());
  ipcMain.handle(
    LANGUAGE_PREFERENCE_IPC_CHANNELS.save,
    (_event, candidate: unknown) => handlers.save(candidate),
  );
}

ipcMain.handle("action:open-status-page", async () => {
  windows.openStatusPage();
  status.doctor = null;
  windows.publishStatus();
  status.doctor = { codex: await checkCodex() };
  windows.publishStatus();
});

ipcMain.handle("local-console:get-url", async () => status.localConsole.url ?? null);
ipcMain.handle("local-console:get-attachment-capability", async () => localConsole.attachmentCapability);

registerSessionLogClipboardIpc({
  ipcMain,
  getPathSource: () => localConsole.pathSource,
  clipboard,
  access: (targetPath) => fs.promises.access(targetPath, fs.constants.R_OK),
});

ipcMain.handle(OPEN_EXTERNAL_LINK_IPC_CHANNEL, async (_event, url: unknown) =>
  openValidatedExternalLink(url, shell));

const teamConversationPreference = createTeamConversationPreferenceService(
  createDesktopTeamConversationPreferencePorts(agentTeamService.listAgentTeams),
);

registerTeamIpc(createDesktopTeamIpcOptions({
  ipcMain,
  dataRoot: status.dataRoot,
  seedTeamsRoot: app.isPackaged
    ? path.join(resolveSeedRoot(), "teams")
    : path.join(projectRoot, "seeds", "teams"),
  seedPending: () => status.seed.status === "pending",
  service: agentTeamService,
  preference: teamConversationPreference,
  shell,
  selectDirectory: (options) => windows.selectDirectory(options),
  relocationTitle: () => translateDesktop(activeLocale, "dialog.relocateTeam"),
  sessionExists: (sessionId) => localConsole.sessionExists(sessionId),
}));

registerProjectIpc({
  ipcMain,
  select: (options) => windows.selectDirectory(options),
  showInFolder: (folderPath) => shell.showItemInFolder(folderPath),
  openDataRoot: async () => {
    await shell.openPath(status.dataRoot);
  },
  openProjectOptions: () => ({
    properties: ["openDirectory", "createDirectory"],
    title: translateDesktop(activeLocale, "dialog.openProject"),
  }),
  repairProjectOptions: () => ({
    properties: ["openDirectory"],
    title: translateDesktop(activeLocale, "dialog.repairProject"),
    buttonLabel: translateDesktop(activeLocale, "dialog.selectLocation"),
  }),
});

const runSettingsUpdateCheck = () => checkDesktopUpdates({
  currentVersion: app.getVersion(),
  fetchLatestRelease: fetchLatestDesktopRelease,
});

registerSettingsIpc({
  ipcMain,
  getVersion: () => app.getVersion(),
  checkForUpdates: runSettingsUpdateCheck,
  clipboard,
});

function resolveSeedRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "seed");
  }
  return projectRoot;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
