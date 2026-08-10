import type { AiTeamBuilder } from "./ai-team-builder/index.js";
import type { SeedCopyOperation, SeedCopyPlan } from "./data-root.js";
import {
  planDesktopDockIcon,
  planDesktopSeedStatus,
} from "./desktop-startup-plan.js";
import type { DesktopLocale } from "./language-preference-contract.js";
import type { OnboardingCliInstallManager } from "./onboarding/cli-installer-manager.js";
import type { OnboardingCliReadinessService } from "./onboarding/cli-readiness.js";
import type { OnboardingCli } from "./onboarding/cli-readiness-contract.js";
import type { ShellPathReadinessGate, ShellPathResult } from "./shell-path.js";
import type { DesktopStatusSnapshot } from "./status.js";

export async function runDesktopStartup(input: {
  status: DesktopStatusSnapshot;
  platform: NodeJS.Platform;
  isPackaged: boolean;
  readLocale(): Promise<DesktopLocale>;
  setLocale(locale: DesktopLocale): void;
  registerLanguage(): void;
  createShellPathGate(apply: (result: ShellPathResult) => void): ShellPathReadinessGate;
  createReadiness(): OnboardingCliReadinessService;
  createBuilder(readiness: OnboardingCliReadinessService, gate: ShellPathReadinessGate): AiTeamBuilder;
  createInstaller(onSucceeded: (cli: OnboardingCli) => Promise<void>): OnboardingCliInstallManager;
  setInstaller(installer: OnboardingCliInstallManager): void;
  observeInstaller(installer: OnboardingCliInstallManager): void;
  registerBuilder(builder: AiTeamBuilder): void;
  registerOnboarding(input: {
    readiness: OnboardingCliReadinessService;
    installer: OnboardingCliInstallManager;
    builder: AiTeamBuilder;
  }): void;
  setDockIcon(): void;
  createWindow(): void;
  publishStatus(): void;
  buildSeedPlan(): Promise<SeedCopyPlan>;
  executeSeedPlan(operations: readonly SeedCopyOperation[]): Promise<void>;
  seedTeams(): Promise<{ status: "seeded" | "skipped" | "conflict" }>;
  migrateOfficialBaselines(): Promise<unknown>;
  startLocalConsole(): Promise<void>;
  startUpdates?(): Promise<void>;
  formatError(error: unknown): string;
}): Promise<void> {
  input.setLocale(await input.readLocale());
  input.registerLanguage();
  const shellPathReady = input.createShellPathGate((shellPath) => {
    input.status.shellPath = shellPath;
    process.env.PATH = shellPath.path;
    input.publishStatus();
  });
  const readiness = input.createReadiness();
  const builder = input.createBuilder(readiness, shellPathReady);
  const installer = input.createInstaller(async (cli) => {
    await readiness.check(cli);
  });
  input.setInstaller(installer);
  input.observeInstaller(installer);
  input.registerBuilder(builder);
  input.registerOnboarding({ readiness, installer, builder });
  const dockPlan = planDesktopDockIcon({
    platform: input.platform,
    isPackaged: input.isPackaged,
  });
  if (dockPlan === "set") {
    input.setDockIcon();
  }
  input.createWindow();
  input.publishStatus();
  shellPathReady.start();
  await shellPathReady.ready;
  try {
    const plan = await input.buildSeedPlan();
    await input.executeSeedPlan(plan.operations);
    const teamSeed = await input.seedTeams();
    input.status.seed = planDesktopSeedStatus({
      copiedFiles: plan.operations.length,
      skippedFiles: plan.skippedDestinations.length,
      teamSeedStatus: teamSeed.status,
    });
  } catch (error) {
    input.status.seed = {
      status: "error",
      copied: 0,
      skipped: 0,
      error: input.formatError(error),
    };
    input.publishStatus();
    return;
  }
  input.publishStatus();
  try {
    await input.migrateOfficialBaselines();
  } catch (error) {
    // Migration is best-effort at startup: a failure keeps the legacy state
    // untouched and is retried on the next launch (see team-official-management).
    console.error(`[moebius] official baseline migration failed: ${input.formatError(error)}`);
  }
  await input.startLocalConsole();
  await input.startUpdates?.();
}
