import {
  resolveStatusPageLocale,
  translateStatusPage,
} from "./locales/index.js";

const elements = {
  version: document.getElementById("version"),
  localConsoleDot: document.getElementById("local-console-dot"),
  localConsoleStatus: document.getElementById("local-console-status"),
  codexDot: document.getElementById("codex-dot"),
  codexStatus: document.getElementById("codex-status"),
  configDot: document.getElementById("config-dot"),
  configStatus: document.getElementById("config-status"),
  dataRoot: document.getElementById("data-root"),
  openDataRoot: document.getElementById("open-data-root"),
};

let locale = resolveStatusPageLocale(new URLSearchParams(window.location.search).get("locale"));
let latestSnapshot = null;

function t(key, values = {}) {
  return translateStatusPage(locale, key, values);
}

function applyLocale(nextLocale) {
  locale = resolveStatusPageLocale(nextLocale);
  document.documentElement.lang = locale;
  document.title = t("title");
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  if (latestSnapshot !== null) {
    renderSnapshot(latestSnapshot);
  }
}

applyLocale(locale);
void window.moebius.readLanguagePreference?.().then(applyLocale);
window.moebius.onLanguagePreferenceChanged?.(applyLocale);

elements.openDataRoot.addEventListener("click", () => {
  void window.moebius.openDataRoot();
});

window.moebius.onStatus((snapshot) => {
  latestSnapshot = snapshot;
  renderSnapshot(snapshot);
});

function renderSnapshot(snapshot) {
  elements.version.textContent = `v${snapshot.appVersion}`;
  elements.dataRoot.textContent = snapshot.dataRoot;
  renderLocalConsole(snapshot.localConsole);
  renderDoctor(snapshot);
}

function renderLocalConsole(localConsole) {
  elements.localConsoleDot.className = "dot";
  elements.localConsoleDot.classList.add(localConsole.status === "running" ? "ok" : localConsole.status === "error" ? "error" : "muted");
  elements.localConsoleStatus.textContent = localConsole.status === "running"
    ? t("running")
    : localConsole.status === "error"
      ? localConsole.error ?? t("unavailable")
      : t(localConsole.status);
}

function renderDoctor(snapshot) {
  renderCheck(elements.codexDot, elements.codexStatus, snapshot.doctor?.codex, t("checking"));

  elements.configDot.className = "dot";
  if (snapshot.seed.status === "ok") {
    elements.configDot.classList.add("ok");
    elements.configStatus.textContent = snapshot.seed.skipped === 0 ? t("initialized") : t("localFilesKept");
  } else if (snapshot.seed.status === "error") {
    elements.configDot.classList.add("error");
    elements.configStatus.textContent = snapshot.seed.error ?? t("initializationFailed");
  } else {
    elements.configDot.classList.add("muted");
    elements.configStatus.textContent = t("initializing");
  }
}

function renderCheck(dot, text, check, pendingText) {
  dot.className = "dot";
  if (check === undefined || check === null) {
    dot.classList.add("muted");
    text.textContent = pendingText;
    return;
  }
  if (check.status === "ok") {
    dot.classList.add("ok");
  } else {
    dot.classList.add("error");
  }
  text.textContent = check.message;
}
