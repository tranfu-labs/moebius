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
  await statusPage.locator("[data-i18n='section.runtime']").waitFor();
  return statusPage;
}

async function readLocale(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.lang);
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
      && await statusPage.locator("[data-i18n='section.runtime']").textContent() === "运行状态",
    {
      locale: await readLocale(statusPage),
      runtimeHeading: await statusPage.locator("[data-i18n='section.runtime']").textContent(),
    },
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
      && await statusPage.locator("[data-i18n='section.runtime']").textContent() === "Runtime status",
    {
      locale: await readLocale(statusPage),
      runtimeHeading: await statusPage.locator("[data-i18n='section.runtime']").textContent(),
    },
  );

  const dialogEn = page.getByRole("dialog", { name: "Settings" });
  await page.keyboard.press("Escape");
  await dialogEn.waitFor({ state: "hidden" });
  const settingsTriggerEn = page.getByRole("button", { name: "Settings" });
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

  await application.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes("/console-page/index.html"));
    target?.setSize(560, 700);
  });
  await page.waitForFunction(() => window.innerWidth <= 560);
  const narrowLayout = await dialogEn.evaluate((dialog) => {
    const aside = dialog.querySelector("aside");
    const section = dialog.querySelector("section");
    const close = dialog.querySelector("button[aria-label='Close']");
    if (aside === null || section === null || close === null) {
      return null;
    }
    const dialogRect = dialog.getBoundingClientRect();
    const asideRect = aside.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const closeRect = close.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      gridTemplateColumns: getComputedStyle(dialog).gridTemplateColumns,
      stacked: sectionRect.top >= asideRect.bottom - 1,
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
    target?.setSize(1180, 760);
  });
  await page.waitForFunction(() => window.innerWidth >= 1180);

  await statusPage.close();
  const newStatusPage = await openStatusWindow(application, page);
  console.log("[desktop-i18n-settings] new status window ready");
  record(
    "new-status-window-starts-en",
    await readLocale(newStatusPage) === "en"
      && await newStatusPage.locator("[data-i18n='section.runtime']").textContent() === "Runtime status",
    {
      locale: await readLocale(newStatusPage),
      runtimeHeading: await newStatusPage.locator("[data-i18n='section.runtime']").textContent(),
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
