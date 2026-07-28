import {
  resolveStatusPageLocale,
  translateStatusPage,
} from "./locales/index.js";

const elements = {
  version: document.getElementById("version"),
  runnerDot: document.getElementById("runner-dot"),
  runnerStatus: document.getElementById("runner-status"),
  runnerDetail: document.getElementById("runner-detail"),
  observerDot: document.getElementById("observer-dot"),
  observerStatus: document.getElementById("observer-status"),
  openObserver: document.getElementById("open-observer"),
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

elements.openObserver.addEventListener("click", () => {
  void window.moebius.openObserver();
});
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
  renderRunner(snapshot.runner);
  renderObserver(snapshot.observer);
  renderDoctor(snapshot);
}

function renderRunner(runner) {
  const dot = elements.runnerDot;
  dot.className = "dot";
  if (runner.status === "running") {
    dot.classList.add("ok");
    elements.runnerStatus.textContent = t("running");
  } else if (runner.status === "starting") {
    dot.classList.add("warn");
    elements.runnerStatus.textContent = t("starting");
  } else if (runner.status === "crashed" && runner.nextRestartDelayMs !== undefined) {
    dot.classList.add("warn");
    elements.runnerStatus.textContent = t("crashedRestarting", {
      current: runner.crashCount,
      maximum: runner.maxCrashCount,
    });
  } else if (runner.status === "crashed") {
    dot.classList.add("error");
    elements.runnerStatus.textContent = t("crashedStopped", { count: runner.crashCount });
  } else {
    dot.classList.add("muted");
    elements.runnerStatus.textContent = t("stopped");
  }

  if (runner.logPath !== undefined && runner.status === "crashed") {
    elements.runnerDetail.textContent = t("log", { path: runner.logPath });
    elements.runnerDetail.classList.remove("hidden");
  } else {
    elements.runnerDetail.textContent = "";
    elements.runnerDetail.classList.add("hidden");
  }
}

function renderObserver(observer) {
  elements.observerDot.className = "dot";
  if (observer.status === "running") {
    elements.observerDot.classList.add("ok");
    elements.observerStatus.textContent = observer.url?.replace("http://", "") ?? t("running");
    elements.openObserver.disabled = false;
  } else if (observer.status === "error") {
    elements.observerDot.classList.add("error");
    elements.observerStatus.textContent = observer.error ?? t("startFailed");
    elements.openObserver.disabled = true;
  } else {
    elements.observerDot.classList.add("warn");
    elements.observerStatus.textContent = t("starting");
    elements.openObserver.disabled = true;
  }
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
