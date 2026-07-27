import "./styles.css";
import {
  DEFAULT_LOCALE,
  isLocale,
  translate,
  type Locale,
  type TranslationKey
} from "./i18n/index.js";
import {
  createSettingsState,
  reduceSettingsState,
  type SettingsState
} from "./settings-state.js";

const STORAGE_KEY = "moebius.prototype.settings.locale";
const SAVE_DELAY_MS = 420;

const workspace = requiredElement<HTMLElement>("#workspace");
const settingsLayer = requiredElement<HTMLElement>("#settings-layer");
const dialog = requiredElement<HTMLElement>("#settings-dialog");
const openButton = requiredElement<HTMLButtonElement>("#open-settings");
const closeButton = requiredElement<HTMLButtonElement>("#close-settings");
const feedback = requiredElement<HTMLElement>("#save-feedback");
const draft = requiredElement<HTMLTextAreaElement>(".composer textarea");
const languageButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-locale]")
);

let state: SettingsState = createSettingsState(readSavedLocale());
let dialogOpen = false;
let failNextSave = false;
let focusReturnTarget: HTMLElement = openButton;
const colorScheme = window.matchMedia("(prefers-color-scheme: light)");

draft.value = "还有一个视觉细节想确认……";
syncTheme();
applyLocale(state.activeLocale);
renderSettingsState();

openButton.addEventListener("click", () => openSettings(openButton));
closeButton.addEventListener("click", closeSettings);

for (const button of languageButtons) {
  button.addEventListener("click", () => {
    const locale = button.dataset.locale;
    if (!isLocale(locale)) return;
    void selectLocale(locale);
  });
}

document.addEventListener("keydown", (event) => {
  if (!dialogOpen) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeSettings();
    return;
  }
  if (event.key !== "Tab") return;

  const focusable = getFocusableElements(dialog);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable.at(-1);

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

colorScheme.addEventListener("change", syncTheme);

window.__settingsPrototype = {
  failNextSave() {
    failNextSave = true;
  },
  clearSavedLocale() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // The in-memory state remains deterministic if storage is unavailable.
    }
    state = createSettingsState(DEFAULT_LOCALE);
    applyLocale(state.activeLocale);
    renderSettingsState();
  },
  getState() {
    return { ...state, dialogOpen };
  }
};

window.setTimeout(() => openSettings(openButton, false), 0);

async function selectLocale(locale: Locale): Promise<void> {
  const nextState = reduceSettingsState(state, { type: "select", locale });
  if (nextState === state) return;
  state = nextState;
  renderSettingsState();
  await persistPendingLocale(locale);
}

async function persistPendingLocale(locale: Locale): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, SAVE_DELAY_MS));

  if (failNextSave) {
    failNextSave = false;
    state = reduceSettingsState(state, { type: "saveFailed", locale });
    renderSettingsState();
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    state = reduceSettingsState(state, { type: "saveFailed", locale });
    renderSettingsState();
    return;
  }

  state = reduceSettingsState(state, { type: "saveSucceeded", locale });
  applyLocale(state.activeLocale);
  renderSettingsState();
}

function retrySave(): void {
  const pendingLocale = state.pendingLocale;
  const nextState = reduceSettingsState(state, { type: "retry" });
  if (nextState === state || pendingLocale === null) return;
  state = nextState;
  renderSettingsState();
  void persistPendingLocale(pendingLocale);
}

function renderSettingsState(): void {
  const busy = state.saveState === "saving";
  const failed = state.saveState === "failed";
  const activeButton = languageButtons.find(
    (button) => button.dataset.locale === state.activeLocale
  );

  for (const button of languageButtons) {
    const buttonLocale = button.dataset.locale;
    const active = buttonLocale === state.activeLocale;
    const pending = buttonLocale === state.pendingLocale;
    button.setAttribute("aria-checked", String(active));
    button.disabled = busy;
    button.classList.toggle("is-selected", active);
    button.classList.toggle("is-pending", pending && busy);
    button.classList.toggle("has-failed", pending && failed);

    const optionState = button.querySelector<HTMLElement>("[data-option-state]");
    if (optionState) {
      optionState.textContent =
        pending && busy
          ? translate(state.activeLocale, "settings.saving")
          : "";
    }
  }

  requiredElement<HTMLElement>("#language-setting").setAttribute(
    "aria-busy",
    String(busy)
  );
  feedback.replaceChildren();

  if (failed) {
    const error = document.createElement("div");
    error.className = "error-notice";
    error.setAttribute("role", "alert");

    const icon = document.createElement("span");
    icon.className = "error-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "!";

    const message = document.createElement("span");
    message.textContent = translate(state.activeLocale, "settings.saveFailed");

    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "retry-button";
    retry.textContent = translate(state.activeLocale, "settings.retry");
    retry.addEventListener("click", retrySave);

    error.append(icon, message, retry);
    feedback.append(error);
    window.setTimeout(() => retry.focus(), 0);
  } else if (!busy) {
    activeButton?.setAttribute("tabindex", "0");
  }
}

function applyLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  document.title = `Moebius · ${translate(locale, "settings.title")}`;

  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    element.textContent = translate(
      locale,
      element.dataset.i18n as TranslationKey
    );
  }
  for (const element of document.querySelectorAll<HTMLElement>(
    "[data-i18n-aria-label]"
  )) {
    element.setAttribute(
      "aria-label",
      translate(
        locale,
        element.dataset.i18nAriaLabel as TranslationKey
      )
    );
  }
  for (const element of document.querySelectorAll<HTMLElement>(
    "[data-i18n-title]"
  )) {
    element.setAttribute(
      "title",
      translate(locale, element.dataset.i18nTitle as TranslationKey)
    );
  }
  for (const element of document.querySelectorAll<HTMLInputElement>(
    "[data-i18n-placeholder]"
  )) {
    element.placeholder = translate(
      locale,
      element.dataset.i18nPlaceholder as TranslationKey
    );
  }
}

function openSettings(
  trigger: HTMLElement,
  restoreFocusOnClose = true
): void {
  if (dialogOpen) return;
  dialogOpen = true;
  focusReturnTarget = restoreFocusOnClose ? trigger : openButton;
  settingsLayer.hidden = false;
  workspace.inert = true;
  document.body.classList.add("has-modal");
  window.setTimeout(() => closeButton.focus(), 0);
}

function closeSettings(): void {
  if (!dialogOpen) return;
  dialogOpen = false;
  settingsLayer.hidden = true;
  workspace.inert = false;
  document.body.classList.remove("has-modal");
  window.setTimeout(() => focusReturnTarget.focus(), 0);
}

function readSavedLocale(): Locale | undefined {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

function syncTheme(): void {
  document.documentElement.dataset.theme = colorScheme.matches ? "light" : "dark";
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute("hidden"));
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required prototype element: ${selector}`);
  return element;
}

declare global {
  interface Window {
    __settingsPrototype: {
      failNextSave(): void;
      clearSavedLocale(): void;
      getState(): SettingsState & { dialogOpen: boolean };
    };
  }
}
