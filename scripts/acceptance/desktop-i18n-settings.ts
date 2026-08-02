import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

interface DesktopI18nEvidence {
  generatedAt: string;
  assertions: Array<{
    id: string;
    passed: boolean;
    observed: unknown;
  }>;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(projectRoot, "desktop");
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-i18n-acceptance-"));
const evidenceRoot = await createAcceptanceOutputDirectory("desktop-i18n-settings");
const stateRoot = path.join(runtimeRoot, ".state");
const preferencePath = path.join(stateRoot, "language-preference.json");
const evidencePath = path.join(evidenceRoot, "desktop-i18n-settings-evidence.json");
const assertions: DesktopI18nEvidence["assertions"] = [];
await fs.writeFile(
  path.join(runtimeRoot, ".onboarding-completed"),
  `${new Date().toISOString()}\n`,
  "utf8",
);

function record(id: string, passed: boolean, observed: unknown): void {
  assertions.push({ id, passed, observed });
}

async function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: [desktopRoot],
    cwd: desktopRoot,
    env: {
      ...process.env,
      MOEBIUS_DATA_ROOT: runtimeRoot,
    },
  });
}

async function mainWindow(application: ElectronApplication): Promise<Page> {
  const first = await application.firstWindow();
  await first.waitForLoadState("domcontentloaded");
  return first;
}

async function openStatusWindow(application: ElectronApplication, page: Page): Promise<Page> {
  const opened = application.waitForEvent("window");
  await page.evaluate(async () => {
    await window.moebius?.openStatusPage?.();
  });
  const statusPage = await opened;
  await statusPage.waitForLoadState("domcontentloaded");
  await statusPage.locator("[data-i18n='section.environment']").waitFor();
  return statusPage;
}

async function readLocale(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.lang);
}

async function waitForUpdateFetchRevision(
  application: ElectronApplication,
  expectedRevision: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const revision = await application.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        __moebiusUpdateFetchRevision?: number;
      };
      return state.__moebiusUpdateFetchRevision ?? 0;
    });
    if (revision >= expectedRevision) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`update fetch revision ${expectedRevision} was not reached`);
}

let application = await launch();
try {
  console.log("[desktop-i18n-settings] launched first application");
  let page = await mainWindow(application);
  console.log("[desktop-i18n-settings] main window ready");
  const settingsTrigger = page.getByRole("button", { name: "设置" });
  await settingsTrigger.waitFor();
  record("default-zh-CN", await readLocale(page) === "zh-CN", {
    locale: await readLocale(page),
    settingsLabel: await settingsTrigger.getAttribute("aria-label"),
  });

  await settingsTrigger.focus();
  await page.keyboard.press("Enter");
  const dialogZh = page.getByRole("dialog", { name: "设置" });
  await dialogZh.waitFor();
  const focusEnteredDialog = await dialogZh.evaluate((dialog) =>
    dialog.contains(document.activeElement));
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press("Tab");
  }
  const focusStayedInDialog = await dialogZh.evaluate((dialog) =>
    dialog.contains(document.activeElement));
  record("keyboard-focus-enters-and-traps", focusEnteredDialog && focusStayedInDialog, {
    focusEnteredDialog,
    focusStayedInDialog,
  });

  const statusPage = await openStatusWindow(application, page);
  console.log("[desktop-i18n-settings] existing status window ready");
  record(
    "existing-status-window-starts-zh-CN",
    await readLocale(statusPage) === "zh-CN"
      && await statusPage.locator("[data-i18n='section.environment']").textContent() === "环境自检",
    {
      locale: await readLocale(statusPage),
      environmentHeading: await statusPage.locator("[data-i18n='section.environment']").textContent(),
    },
  );
  const legacyUpdateEntry = {
    statusButtonCount: await statusPage.locator("#check-updates").count(),
    preloadCapability: await page.evaluate(() =>
      window.moebius !== undefined && "checkUpdates" in window.moebius),
  };
  record(
    "status-page-removes-migrated-update-entry",
    legacyUpdateEntry.statusButtonCount === 0 && !legacyUpdateEntry.preloadCapability,
    legacyUpdateEntry,
  );

  await page.evaluate(() => {
    document.documentElement.removeAttribute("data-locale-commit-at");
    const observer = new MutationObserver(() => {
      if (document.documentElement.lang === "en") {
        document.documentElement.setAttribute("data-locale-commit-at", String(Date.now()));
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"],
    });
  });

  await fs.mkdir(stateRoot, { recursive: true });
  await fs.chmod(stateRoot, 0o500);
  const englishOption = page.getByRole("radio", { name: "English" });
  await englishOption.focus();
  await page.keyboard.press("Space");
  const failureAlert = page.getByRole("alert");
  await failureAlert.waitFor();
  const failedLanguageFocus = await englishOption.evaluate(
    (option) => document.activeElement === option,
  );
  let preferenceExistsAfterFailure = true;
  try {
    await fs.access(preferencePath);
  } catch {
    preferenceExistsAfterFailure = false;
  }
  const failureLocales = {
    main: await readLocale(page),
    status: await readLocale(statusPage),
  };
  record(
    "failed-save-does-not-commit-or-broadcast",
    !preferenceExistsAfterFailure
      && failureLocales.main === "zh-CN"
      && failureLocales.status === "zh-CN",
    {
      preferenceExists: preferenceExistsAfterFailure,
      locales: failureLocales,
      failureMessage: await failureAlert.textContent(),
      retryVisible: await page.getByRole("button", { name: "重试" }).isVisible(),
      focusStayedOnLanguage: failedLanguageFocus,
    },
  );
  record(
    "language-control-retains-focus-through-failure",
    failedLanguageFocus,
    {
      activeElement: await page.evaluate(() =>
        document.activeElement?.getAttribute("value")
          ?? document.activeElement?.tagName
          ?? null),
    },
  );

  await fs.chmod(stateRoot, 0o700);
  const retryButton = page.getByRole("button", { name: "重试" });
  await retryButton.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await statusPage.waitForFunction(() => document.documentElement.lang === "en");
  await page.getByRole("dialog", { name: "Settings" }).waitFor();
  console.log("[desktop-i18n-settings] failure and retry path complete");
  const savedDocument = JSON.parse(await fs.readFile(preferencePath, "utf8")) as {
    version?: unknown;
    locale?: unknown;
  };
  const preferenceStat = await fs.stat(preferencePath);
  const commitAt = Number(await page.locator("html").getAttribute("data-locale-commit-at"));
  record(
    "retry-persists-before-locale-commit",
    savedDocument.version === 1
      && savedDocument.locale === "en"
      && Number.isFinite(commitAt)
      && preferenceStat.mtimeMs <= commitAt,
    {
      savedDocument,
      preferenceMtimeMs: preferenceStat.mtimeMs,
      rendererCommitAtMs: commitAt,
      ordering: preferenceStat.mtimeMs <= commitAt ? "persisted-before-renderer-commit" : "invalid",
    },
  );
  record(
    "existing-status-window-receives-en",
    await readLocale(statusPage) === "en"
      && await statusPage.locator("[data-i18n='section.environment']").textContent() === "Environment checks",
    {
      locale: await readLocale(statusPage),
      environmentHeading: await statusPage.locator("[data-i18n='section.environment']").textContent(),
    },
  );

  const chineseOption = page.getByRole("radio", { name: "简体中文" });
  await chineseOption.focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
  const chineseFocusAfterSuccess = await chineseOption.evaluate(
    (option) => document.activeElement === option,
  );
  const englishOptionAgain = page.getByRole("radio", { name: "English" });
  await englishOptionAgain.focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  const englishFocusAfterSuccess = await englishOptionAgain.evaluate(
    (option) => document.activeElement === option,
  );
  record(
    "language-control-retains-focus-through-success",
    chineseFocusAfterSuccess && englishFocusAfterSuccess,
    { chineseFocusAfterSuccess, englishFocusAfterSuccess },
  );

  const dialogEn = page.getByRole("dialog", { name: "Settings" });
  await page.keyboard.press("Escape");
  await dialogEn.waitFor({ state: "hidden" });
  const settingsTriggerEn = page.getByRole("button", { name: "Settings" });
  await page.waitForFunction(() =>
    document.activeElement?.getAttribute("aria-label") === "Settings");
  record(
    "escape-closes-and-restores-trigger-focus",
    await settingsTriggerEn.evaluate((button) => document.activeElement === button),
    {
      dialogVisible: await dialogEn.isVisible(),
      activeElementLabel: await page.evaluate(() =>
        document.activeElement?.getAttribute("aria-label")
          ?? document.activeElement?.textContent?.trim()
          ?? null),
    },
  );
  await page.keyboard.press("Enter");
  await dialogEn.waitFor();

  await page.getByRole("button", { name: "About" }).click();
  const aboutVersion = await page.getByText("0.1.4", { exact: true }).textContent();
  const platformAlignment = await page.getByText("Apple Silicon Mac", { exact: true }).evaluate(
    (element) => getComputedStyle(element).textAlign,
  );
  record(
    "about-reads-production-version-and-right-aligns-platform",
    aboutVersion === "0.1.4" && platformAlignment === "right",
    { aboutVersion, platformAlignment },
  );

  await page.getByRole("button", { name: "Copy version info" }).click();
  const copiedVersion = await application.evaluate(({ clipboard }) => clipboard.readText());
  record(
    "copy-version-uses-fixed-main-process-format",
    copiedVersion === "Moebius 0.1.4 · Apple Silicon Mac",
    { copiedVersion },
  );

  await application.evaluate(({ shell }) => {
    const state = globalThis as typeof globalThis & {
      __moebiusExternalLinks?: string[];
      __moebiusOriginalOpenExternal?: typeof shell.openExternal;
    };
    state.__moebiusExternalLinks = [];
    state.__moebiusOriginalOpenExternal = shell.openExternal.bind(shell);
    shell.openExternal = (async (url: string) => {
      state.__moebiusExternalLinks?.push(url);
    }) as typeof shell.openExternal;
  });
  await page.getByRole("button", { name: "Release notes" }).click();
  await page.getByRole("button", { name: "Report an issue" }).click();
  await page.getByRole("button", { name: "Open-source repository" }).click();
  const publicLinks = await application.evaluate(() => {
    const state = globalThis as typeof globalThis & { __moebiusExternalLinks?: string[] };
    return state.__moebiusExternalLinks ?? [];
  });
  const feedbackUrl = new URL(publicLinks[1] ?? "https://invalid.local");
  record(
    "public-links-use-safe-system-browser-contract",
    publicLinks[0] === "https://github.com/tranfu-labs/moebius/releases"
      && feedbackUrl.origin === "https://github.com"
      && feedbackUrl.pathname === "/tranfu-labs/moebius/issues/new"
      && feedbackUrl.searchParams.get("body") === "Moebius 0.1.4 · Apple Silicon Mac"
      && publicLinks[2] === "https://github.com/tranfu-labs/moebius",
    { publicLinks },
  );

  await application.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      fetch: typeof fetch;
      __moebiusOriginalFetch?: typeof fetch;
      __moebiusResolveUpdateFetch?: () => void;
      __moebiusUpdateFetchRevision?: number;
    };
    state.__moebiusOriginalFetch = state.fetch;
    state.__moebiusUpdateFetchRevision = 0;
    state.fetch = (() => {
      state.__moebiusUpdateFetchRevision = (state.__moebiusUpdateFetchRevision ?? 0) + 1;
      return new Promise<Response>((resolve) => {
      state.__moebiusResolveUpdateFetch = () => {
        resolve(new Response(JSON.stringify({
          tag_name: "v99.0.0",
          html_url: "https://github.com/tranfu-labs/moebius/releases/tag/v99.0.0",
          draft: false,
          prerelease: false,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      };
      });
    }) as typeof fetch;
  });
  const checkButton = page.getByRole("button", { name: "Check for updates" });
  await checkButton.focus();
  await page.keyboard.press("Enter");
  const checkingButton = page.getByRole("button", { name: "Checking…" });
  await checkingButton.waitFor();
  await waitForUpdateFetchRevision(application, 1);
  const updateFocusWhileChecking = await checkingButton.evaluate(
    (button) => document.activeElement === button,
  );
  record(
    "update-control-retains-focus-while-checking",
    updateFocusWhileChecking,
    {
      activeElement: await page.evaluate(() =>
        document.activeElement?.textContent?.trim()
          ?? document.activeElement?.tagName
          ?? null),
      ariaDisabled: await checkingButton.getAttribute("aria-disabled"),
    },
  );
  await page.getByRole("button", { name: "Close" }).click();
  await settingsTriggerEn.click();
  await dialogEn.waitFor();
  const reopenedCheckingState = {
    aboutCurrent: await page.getByRole("button", { name: "About" }).getAttribute("aria-current"),
    checkingVisible: await page.getByRole("button", { name: "Checking…" }).isVisible(),
  };
  record(
    "settings-entry-restores-in-progress-update-section",
    reopenedCheckingState.aboutCurrent === "page" && reopenedCheckingState.checkingVisible,
    reopenedCheckingState,
  );
  await page.getByRole("button", { name: "Close" }).click();
  await application.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __moebiusResolveUpdateFetch?: () => void;
    };
    state.__moebiusResolveUpdateFetch?.();
  });
  await page.getByText("Version 99.0.0 is available.").waitFor();
  const workspaceNotification = page.getByTestId("settings-notifications");
  record(
    "closed-update-completes-with-workspace-notification",
    await workspaceNotification.isVisible(),
    { text: await workspaceNotification.textContent() },
  );
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByText("Version 99.0.0 is available").waitFor();

  const checkAgainButton = page.getByRole("button", { name: "Check again" });
  await checkAgainButton.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Checking…" }).waitFor();
  await waitForUpdateFetchRevision(application, 2);
  await application.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __moebiusResolveUpdateFetch?: () => void;
    };
    state.__moebiusResolveUpdateFetch?.();
  });
  await page.getByText("Version 99.0.0 is available").waitFor();
  const terminalCheckButton = page.getByRole("button", { name: "Check again" });
  const updateFocusAtTerminal = await terminalCheckButton.evaluate(
    (button) => document.activeElement === button,
  );
  record(
    "update-control-retains-focus-at-terminal-result",
    updateFocusAtTerminal,
    {
      activeElement: await page.evaluate(() =>
        document.activeElement?.textContent?.trim()
          ?? document.activeElement?.tagName
          ?? null),
    },
  );
  await page.getByRole("button", { name: "Download update" }).click();
  const linksAfterDownload = await application.evaluate(() => {
    const state = globalThis as typeof globalThis & { __moebiusExternalLinks?: string[] };
    return state.__moebiusExternalLinks ?? [];
  });
  record(
    "download-opens-only-after-explicit-activation",
    linksAfterDownload.length === 4
      && linksAfterDownload[3]
        === "https://github.com/tranfu-labs/moebius/releases/tag/v99.0.0",
    { linksAfterDownload },
  );

  record(
    "available-update-shows-version-and-download",
    await page.getByText("Version 99.0.0 is available").isVisible()
      && await page.getByRole("button", { name: "Download update" }).isEnabled(),
    {
      versionText: await page.getByText("Version 99.0.0 is available").textContent(),
      downloadEnabled: await page.getByRole("button", { name: "Download update" }).isEnabled(),
    },
  );

  await application.evaluate(() => {
    const state = globalThis as typeof globalThis & { fetch: typeof fetch };
    state.fetch = (async () => new Response(JSON.stringify({
      tag_name: "v0.1.4",
      html_url: "https://github.com/tranfu-labs/moebius/releases/tag/v0.1.4",
      draft: false,
      prerelease: false,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  });
  await page.getByRole("button", { name: "Check again" }).click();
  await page.getByText("You're up to date").waitFor();
  record(
    "latest-update-shows-terminal-result",
    await page.getByText("You're up to date").isVisible()
      && await page.getByRole("button", { name: "Check again" }).isEnabled(),
    {
      latestText: await page.getByText("You're up to date").textContent(),
      checkAgainEnabled: await page.getByRole("button", { name: "Check again" }).isEnabled(),
    },
  );

  await application.evaluate(() => {
    const state = globalThis as typeof globalThis & { fetch: typeof fetch };
    state.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
  });
  await page.getByRole("button", { name: "Check again" }).click();
  await page.getByText("The update check failed. Check your connection and try again.").waitFor();
  const updateRetry = page.getByRole("button", { name: "Retry" });
  record(
    "failed-update-shows-retry",
    await updateRetry.isEnabled(),
    {
      failureText: await page
        .getByText("The update check failed. Check your connection and try again.")
        .textContent(),
      retryEnabled: await updateRetry.isEnabled(),
    },
  );

  await application.evaluate(() => {
    const state = globalThis as typeof globalThis & { fetch: typeof fetch };
    state.fetch = (async () => new Response(JSON.stringify({
      tag_name: "v0.1.4",
      html_url: "https://github.com/tranfu-labs/moebius/releases/tag/v0.1.4",
      draft: false,
      prerelease: false,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  });
  await updateRetry.click();
  await page.getByText("You're up to date").waitFor();
  record(
    "failed-update-retry-recovers",
    await page.getByText("You're up to date").isVisible(),
    { latestText: await page.getByText("You're up to date").textContent() },
  );

  await application.evaluate(({ shell }) => {
    const state = globalThis as typeof globalThis & {
      fetch: typeof fetch;
      __moebiusOriginalFetch?: typeof fetch;
      __moebiusResolveUpdateFetch?: () => void;
      __moebiusUpdateFetchRevision?: number;
      __moebiusOriginalOpenExternal?: typeof shell.openExternal;
    };
    if (state.__moebiusOriginalFetch !== undefined) {
      state.fetch = state.__moebiusOriginalFetch;
      delete state.__moebiusOriginalFetch;
    }
    delete state.__moebiusResolveUpdateFetch;
    delete state.__moebiusUpdateFetchRevision;
    if (state.__moebiusOriginalOpenExternal !== undefined) {
      shell.openExternal = state.__moebiusOriginalOpenExternal;
      delete state.__moebiusOriginalOpenExternal;
    }
  });

  await application.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes("/console-page/index.html"));
    target?.setContentSize(900, 640);
  });
  await page.waitForFunction(() => window.innerWidth === 900 && window.innerHeight === 640);
  const regularLayout = await dialogEn.evaluate((dialog) => {
    const navigation = dialog.querySelector("nav");
    const content = navigation?.nextElementSibling;
    if (navigation === null || navigation === undefined || content === null || content === undefined) {
      return null;
    }
    const navigationRect = navigation.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    return {
      navigationAtLeft: contentRect.left >= navigationRect.right - 1,
      noHorizontalOverflow: dialog.scrollWidth <= dialog.clientWidth,
    };
  });
  record(
    "regular-window-keeps-side-navigation",
    regularLayout?.navigationAtLeft === true && regularLayout.noHorizontalOverflow,
    regularLayout,
  );

  await application.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes("/console-page/index.html"));
    target?.setContentSize(560, 640);
  });
  await page.waitForFunction(() => window.innerWidth <= 560 && window.innerHeight === 640);
  const narrowLayout = await dialogEn.evaluate((dialog) => {
    const navigation = dialog.querySelector("nav");
    const content = navigation?.nextElementSibling;
    const close = dialog.querySelector("button[aria-label='Close']");
    if (navigation === null || navigation === undefined
      || content === null || content === undefined || close === null) {
      return null;
    }
    const dialogRect = dialog.getBoundingClientRect();
    const navigationRect = navigation.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const closeRect = close.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      gridTemplateColumns: getComputedStyle(dialog).gridTemplateColumns,
      stacked: contentRect.top >= navigationRect.bottom - 1,
      noHorizontalOverflow: dialog.scrollWidth <= dialog.clientWidth,
      dialogWithinViewport: dialogRect.left >= 0 && dialogRect.right <= window.innerWidth,
      closeWithinViewport: closeRect.left >= 0 && closeRect.right <= window.innerWidth,
    };
  });
  record(
    "narrow-window-stacks-settings-without-clipping",
    narrowLayout !== null
      && narrowLayout.stacked
      && narrowLayout.noHorizontalOverflow
      && narrowLayout.dialogWithinViewport
      && narrowLayout.closeWithinViewport,
    narrowLayout,
  );

  await page.mouse.click(4, 4);
  record("backdrop-does-not-close-settings", await dialogEn.isVisible(), {
    dialogVisible: await dialogEn.isVisible(),
  });

  await application.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes("/console-page/index.html"));
    target?.setContentSize(900, 480);
  });
  await page.waitForFunction(() => window.innerWidth === 900 && window.innerHeight === 480);
  await page.getByRole("button", { name: "Check again" }).focus();
  const shortLayout = await dialogEn.evaluate((dialog) => {
    const header = dialog.querySelector("header");
    const navigation = dialog.querySelector("nav");
    const content = navigation?.nextElementSibling as HTMLElement | null | undefined;
    const close = dialog.querySelector("button[aria-label='Close']");
    if (header === null || content === null || content === undefined || close === null) {
      return null;
    }
    const focusedBefore = document.activeElement;
    content.scrollTop = content.scrollHeight;
    const dialogRect = dialog.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const closeRect = close.getBoundingClientRect();
    return {
      headerVisible: headerRect.top >= dialogRect.top && headerRect.bottom <= dialogRect.bottom,
      closeVisible: closeRect.top >= dialogRect.top && closeRect.bottom <= dialogRect.bottom,
      contentOwnsScrolling: getComputedStyle(content).overflowY === "auto",
      focusPreserved: document.activeElement === focusedBefore,
      noHorizontalOverflow: dialog.scrollWidth <= dialog.clientWidth,
    };
  });
  record(
    "short-window-keeps-header-and-focus-while-content-scrolls",
    shortLayout?.headerVisible === true
      && shortLayout.closeVisible
      && shortLayout.contentOwnsScrolling
      && shortLayout.focusPreserved
      && shortLayout.noHorizontalOverflow,
    shortLayout,
  );

  await application.evaluate(({ dialog }) => {
    const state = globalThis as typeof globalThis & {
      __moebiusNativeDialogEvidence?: Array<{ title?: string; buttonLabel?: string }>;
      __moebiusOriginalShowOpenDialog?: typeof dialog.showOpenDialog;
    };
    state.__moebiusNativeDialogEvidence = [];
    state.__moebiusOriginalShowOpenDialog = dialog.showOpenDialog.bind(dialog);
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      const options = args.at(-1) as { title?: string; buttonLabel?: string };
      state.__moebiusNativeDialogEvidence?.push({
        title: options.title,
        buttonLabel: options.buttonLabel,
      });
      return { canceled: true, filePaths: [] };
    }) as typeof dialog.showOpenDialog;
  });
  await page.evaluate(async () => {
    await window.moebius?.selectProjectFolder?.();
  });
  const nativeDialogEvidence = await application.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __moebiusNativeDialogEvidence?: Array<{ title?: string; buttonLabel?: string }>;
    };
    return state.__moebiusNativeDialogEvidence ?? [];
  });
  record(
    "native-dialog-uses-active-en",
    nativeDialogEvidence[0]?.title === "Open local project folder",
    nativeDialogEvidence[0] ?? null,
  );

  await application.evaluate(({ dialog }) => {
    const state = globalThis as typeof globalThis & {
      __moebiusOriginalShowOpenDialog?: typeof dialog.showOpenDialog;
    };
    if (state.__moebiusOriginalShowOpenDialog !== undefined) {
      dialog.showOpenDialog = state.__moebiusOriginalShowOpenDialog;
      delete state.__moebiusOriginalShowOpenDialog;
    }
  });
  await page.getByRole("button", { name: "Close" }).click();
  await dialogEn.waitFor({ state: "hidden" });
  await application.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes("/console-page/index.html"));
    target?.setContentSize(1180, 760);
  });
  await page.waitForFunction(() => window.innerWidth >= 1180);

  await statusPage.close();
  const newStatusPage = await openStatusWindow(application, page);
  console.log("[desktop-i18n-settings] new status window ready");
  record(
    "new-status-window-starts-en",
    await readLocale(newStatusPage) === "en"
      && await newStatusPage.locator("[data-i18n='section.environment']").textContent() === "Environment checks",
    {
      locale: await readLocale(newStatusPage),
      environmentHeading: await newStatusPage.locator("[data-i18n='section.environment']").textContent(),
    },
  );

  await application.close();
  application = await launch();
  console.log("[desktop-i18n-settings] relaunched application");
  page = await mainWindow(application);
  await page.getByRole("button", { name: "Settings" }).waitFor();
  record("restart-restores-en", await readLocale(page) === "en", {
    locale: await readLocale(page),
    settingsLabel: await page.getByRole("button", { name: "Settings" }).getAttribute("aria-label"),
  });
} finally {
  await fs.chmod(stateRoot, 0o700).catch(() => undefined);
  await application.close().catch(() => undefined);
  const evidence: DesktopI18nEvidence = {
    generatedAt: new Date().toISOString(),
    assertions,
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, evidence: evidencePath })}\n`);
  await fs.rm(runtimeRoot, { recursive: true, force: true });
}

if (assertions.some((assertion) => !assertion.passed)) {
  process.exitCode = 1;
}
