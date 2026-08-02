import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  app,
  clipboard,
  ipcMain,
  shell,
} from "electron";
import { startLocalConsoleServer } from "../../src/local-console/start.js";
import { createSqliteLocalConsoleStore } from "../../src/local-console/store.js";
import { closeSqliteStateWorkers } from "../../src/sqlite-state.js";
import { formatLocalError } from "../../src/local-console/runtime-domain.js";
import {
  buildSeedCopyPlan,
  executeSeedCopyPlan,
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
import {
  createDesktopAgentTeamServicePorts,
  createDesktopTeamConversationPreferencePorts,
  createDesktopTeamRuntimeBindingPorts,
} from "./desktop-team-wiring.js";
import { createDesktopTeamIpcOptions } from "./desktop-team-ipc-wiring.js";
import { checkDesktopUpdates, fetchLatestDesktopRelease } from "./updater.js";
import { registerDesktopCoreIpc } from "./desktop-core-ipc-register.js";
import { configureDesktopProcess } from "./desktop-process-config.js";
import { registerDesktopLifecycle } from "./desktop-lifecycle-register.js";
import { registerOnboardingIpc } from "./onboarding/register.js";
import { ONBOARDING_IPC_CHANNELS } from "./onboarding/contract.js";
import { OnboardingCliReadinessService } from "./onboarding/cli-readiness.js";
import { OnboardingCliInstallManager } from "./onboarding/cli-installer-manager.js";
import {
  installerCleanupBlockedDialogOptions,
  installerQuitDialogOptions,
} from "./onboarding/shutdown-coordination.js";
import type { DesktopLocale } from "./language-preference-contract.js";
import { registerLanguagePreferenceIpc } from "./language-preference-ipc.js";
import {
  readLanguagePreference,
  saveLanguagePreference,
} from "./language-preference.js";
import { translateDesktop } from "./i18n/index.js";

const { dirname, dataRoot, seedRoot, seedTeamsRoot } = configureDesktopProcess({
  app,
  moduleUrl: import.meta.url,
  env: process.env,
});

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
  hasRunningInstallers: () => shutdown.hasRunningInstallers(),
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
  formatError: formatLocalError,
});

shutdown = new DesktopShutdownRuntime({
  closeLocalConsole: () => localConsole.close(),
  closeStateWorkers: closeSqliteStateWorkers,
  quit: () => app.quit(),
  getInstaller: () => onboardingCliInstaller,
  confirmInstallerCancellation: async (running) => {
    const response = await windows.showMessageBox(
      installerQuitDialogOptions(running, activeLocale),
    );
    return response !== 0;
  },
  reportCleanupBlocked: async () => {
    await windows.showMessageBox(installerCleanupBlockedDialogOptions(activeLocale));
  },
});

registerDesktopLifecycle({
  app,
  focusMainWindow: () => windows.focusMainWindow(),
  boot,
  beforeQuit: (preventDefault) => shutdown.beforeQuit(preventDefault),
  lastWindowClosed: () => shutdown.lastWindowClosed(),
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
    registerLanguage: registerDesktopLanguagePreferenceIpc,
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
    buildSeedPlan: () => buildSeedCopyPlan({ seedRoot, dataRoot: status.dataRoot }),
    executeSeedPlan: executeSeedCopyPlan,
    seedTeams: () => seedBuiltInTeams({
      seedTeamsRoot,
      dataRoot: status.dataRoot,
    }),
    startLocalConsole: () => localConsole.start(),
    formatError: formatLocalError,
  });
}

function registerDesktopLanguagePreferenceIpc(): void {
  registerLanguagePreferenceIpc({
    ipcMain,
    dependencies: {
      getActiveLocale: () => activeLocale,
      setActiveLocale: (locale) => {
        activeLocale = locale;
      },
      persist: (locale) => saveLanguagePreference(status.dataRoot, locale),
      getBroadcastTargets: () => windows.getBroadcastTargets(),
    },
  });
}

registerDesktopCoreIpc({
  ipcMain,
  clipboard,
  shell,
  openStatusPage: () => windows.openStatusPage(),
  refreshDoctor: async () => {
    status.doctor = null;
    windows.publishStatus();
    status.doctor = { codex: await checkCodex() };
    windows.publishStatus();
  },
  getLocalConsoleUrl: () => localConsole.url,
  getAttachmentCapability: () => localConsole.attachmentCapability,
  getPathSource: () => localConsole.pathSource,
  selectDirectory: (options) => windows.selectDirectory(options),
  openProjectTitle: () => translateDesktop(activeLocale, "dialog.openProject"),
  repairProjectTitle: () => translateDesktop(activeLocale, "dialog.repairProject"),
  selectLocationLabel: () => translateDesktop(activeLocale, "dialog.selectLocation"),
  dataRoot: status.dataRoot,
  getVersion: () => app.getVersion(),
  checkForUpdates: (currentVersion) => checkDesktopUpdates({
    currentVersion,
    fetchLatestRelease: fetchLatestDesktopRelease,
  }),
});

const teamConversationPreference = createTeamConversationPreferenceService(
  createDesktopTeamConversationPreferencePorts(agentTeamService.listAgentTeams),
);

registerTeamIpc(createDesktopTeamIpcOptions({
  ipcMain,
  dataRoot: status.dataRoot,
  seedTeamsRoot,
  seedPending: () => status.seed.status === "pending",
  service: agentTeamService,
  preference: teamConversationPreference,
  shell,
  selectDirectory: (options) => windows.selectDirectory(options),
  relocationTitle: () => translateDesktop(activeLocale, "dialog.relocateTeam"),
  sessionExists: (sessionId) => localConsole.sessionExists(sessionId),
}));
