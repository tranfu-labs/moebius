import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  app,
  clipboard,
  ipcMain,
  safeStorage,
  shell,
} from "electron";
// electron-updater exposes a CommonJS main entry; keep the runtime import compatible
// with the ESM bundle emitted for the packaged desktop main process.
import electronUpdater from "electron-updater";
import { startLocalConsoleServer } from "../../src/local-console/start.js";
import { createSqliteLocalConsoleStore } from "../../src/local-console/store.js";
import { closeSqliteStateWorkers } from "../../src/sqlite-state.js";
import { formatLocalError } from "../../src/local-console/runtime-domain.js";
import {
  buildSeedCopyPlan,
  executeSeedCopyPlan,
} from "./data-root.js";
import { DesktopWindowRuntime } from "./desktop-window-runtime.js";
import { DesktopLocalConsoleRuntime } from "./desktop-local-console-runtime.js";
import { DesktopShutdownRuntime } from "./desktop-shutdown-runtime.js";
import { runDesktopStartup } from "./desktop-startup-runtime.js";
import { createShellPathReadinessGate, resolveShellPath } from "./shell-path.js";
import type { DesktopStatusSnapshot } from "./status.js";
import { registerAiTeamBuilderIpc } from "./ai-team-builder-ipc.js";
import { AiTeamBuilder } from "./ai-team-builder/index.js";
import { AiTeamBuilderPiSpawner } from "./ai-team-builder/pi-spawner.js";
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
import { DesktopUpdateRuntime } from "./desktop-update-runtime.js";
import type { DesktopUpdateProvider } from "./desktop-update-contract.js";
import { createDesktopUpdateReadyStore } from "./desktop-update-store.js";
import { registerDesktopMainInfrastructureIpc } from "./desktop-main-infrastructure-ipc.js";
import { configureDesktopProcess } from "./desktop-process-config.js";
import { registerDesktopLifecycle } from "./desktop-lifecycle-register.js";
import { createDesktopProviderProfileWiring } from "./provider-profile-wiring.js";
import { registerOnboardingIpc } from "./onboarding/register.js";
import { ONBOARDING_IPC_CHANNELS } from "./onboarding/contract.js";
import { OnboardingCliReadinessService } from "./onboarding/cli-readiness.js";
import { OnboardingCliInstallManager } from "./onboarding/cli-installer-manager.js";
import {
  exitTaskDialogOptions,
  installUpdateDialogOptions,
} from "./onboarding/shutdown-coordination.js";
import type { DesktopLocale } from "./language-preference-contract.js";
import {
  readLanguagePreference,
} from "./language-preference.js";
import { translateDesktop } from "./i18n/index.js";

const { autoUpdater } = electronUpdater;

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
let aiTeamBuilder: AiTeamBuilder | null = null;
let activeLocale: DesktopLocale = "zh-CN";
let shutdown!: DesktopShutdownRuntime;
let localConsole!: DesktopLocalConsoleRuntime;

const status: DesktopStatusSnapshot = {
  appVersion: app.getVersion(),
  dataRoot,
  localConsole: { status: "starting" },
  doctor: null,
  shellPath: null,
  seed: { status: "pending", copied: 0, skipped: 0 },
  update: null,
};

const providerWiring = createDesktopProviderProfileWiring({
  dataRoot,
  dirname,
  agentTeamService,
  seedPending: () => status.seed.status === "pending",
  safeStorage,
  getSessionRuntime: () => localConsole?.pathSource ?? null,
});
const { runPi } = providerWiring;

const windows = new DesktopWindowRuntime({
  dirname,
  platform: process.platform,
  status,
  locale: () => activeLocale,
  isQuitting: () => shutdown.isQuitting,
  hasRunningTasks: () => shutdown.hasRunningTasks(),
  requestShutdown: () => shutdown.request(),
  statusTitle: () => translateDesktop(activeLocale, "window.statusTitle"),
});

const updateRuntime = new DesktopUpdateRuntime({
  platform: process.platform,
  arch: process.arch,
  isPackaged: app.isPackaged,
  currentVersion: app.getVersion(),
  provider: autoUpdater as unknown as DesktopUpdateProvider,
  readyStore: createDesktopUpdateReadyStore(
    path.join(status.dataRoot, ".state", "desktop-update-ready.json"),
  ),
  publish: (state) => windows.sendMain("settings:update-state", state),
  onInstallFailure: async () => {
    await localConsole.start();
    shutdown.recoverAfterInstallFailure();
  },
});

localConsole = new DesktopLocalConsoleRuntime({
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
    runPi,
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

let providerProfileOperations: { getRunningTaskCount(): number; cancelAll(): void } | null = null;
shutdown = new DesktopShutdownRuntime({
  closeLocalConsole: () => localConsole.close(),
  closeStateWorkers: closeSqliteStateWorkers,
  quit: () => app.quit(),
  reportCleanupBlocked: async () => {
    await windows.showMessageBox({
      type: "error",
      buttons: [translateDesktop(activeLocale, "dialog.quit.stay")],
      defaultId: 0,
      cancelId: 0,
      title: translateDesktop(activeLocale, "dialog.cleanup.title"),
      message: translateDesktop(activeLocale, "dialog.cleanup.message"),
      detail: translateDesktop(activeLocale, "dialog.cleanup.detail"),
      noLink: true,
    });
  },
  getRunningTaskCount: () => localConsole.getRunningTaskCount()
    + (aiTeamBuilder?.getRunningTaskCount() ?? 0)
    + (onboardingCliInstaller?.getRunningClis().length ?? 0)
    + (providerProfileOperations?.getRunningTaskCount() ?? 0),
  cancelRunningTasks: async () => {
    await aiTeamBuilder?.cancelAll();
    await onboardingCliInstaller?.cancelAll();
    providerProfileOperations?.cancelAll();
  },
  confirmExit: async (runningTaskCount) => {
    if (runningTaskCount === 0) {
      return true;
    }
    const response = await windows.showMessageBox(exitTaskDialogOptions(runningTaskCount, activeLocale));
    return response !== 0;
  },
  confirmInstall: async (runningTaskCount) => {
    const response = await windows.showMessageBox(installUpdateDialogOptions(
      updateRuntime.state.latestVersion ?? app.getVersion(),
      runningTaskCount,
      activeLocale,
    ));
    return response !== 0;
  },
  installUpdate: () => updateRuntime.install(),
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
    registerLanguage: () => undefined,
    createShellPathGate: (apply) => createShellPathReadinessGate({
      resolve: () => resolveShellPath({ platform: process.platform, currentPath: process.env.PATH }),
      apply,
    }),
    createReadiness: () => new OnboardingCliReadinessService(),
    createBuilder: (readiness, gate) => {
      aiTeamBuilder = new AiTeamBuilder({
        dataRoot: status.dataRoot,
        pi: new AiTeamBuilderPiSpawner(runPi),
        resolveExecutionProfile: () => gate.afterReady(async () => {
          try {
            return await readiness.ensureBuilderExecutionProfile();
          } catch {
            return await providerWiring.resolveReadyExecutionProfile();
          }
        }),
      });
      return aiTeamBuilder;
    },
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
    startUpdates: () => updateRuntime.start(),
    formatError: formatLocalError,
  });
}

providerProfileOperations = registerDesktopMainInfrastructureIpc({
  ipcMain,
  clipboard,
  shell,
  windows,
  localConsole,
  updateRuntime,
  shutdown,
  providerProfileService: providerWiring.service,
  status,
  dataRoot: status.dataRoot,
  getLocale: () => activeLocale,
  setLocale: (locale) => { activeLocale = locale; },
  appVersion: app.getVersion(),
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
