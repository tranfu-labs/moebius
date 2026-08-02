import { I18nProvider, useI18n, type Locale } from "@moebius/console-ui";
import { createContext, useContext, type ComponentType } from "react";
import { HashRouter } from "react-router-dom";

import {
  createLanguageState,
} from "./language-state.js";
import { DesktopRoutesController } from "./desktop-routes-controller.js";
import {
  useDesktopLanguageController,
  type DesktopLanguageBundle,
} from "./use-desktop-language.js";

interface OperatorConsoleRouteProps {
  pendingAgentTeamKey: string | null;
  onReplayOnboarding(): void;
}

const DesktopLanguageContext = createContext<DesktopLanguageBundle | null>(null);
const FALLBACK_DESKTOP_LANGUAGE: DesktopLanguageBundle = {
  ...createLanguageState("zh-CN"),
  selectLocale: () => undefined,
  retry: () => undefined,
};

export function DesktopApplicationRoot(props: {
  operatorConsole: ComponentType<OperatorConsoleRouteProps>;
}): JSX.Element {
  const languageBundle = useDesktopLanguageController({
    api: window.moebius,
    search: window.location.search,
  });
  return (
    <DesktopLanguageContext.Provider value={languageBundle}>
      <I18nProvider locale={languageBundle.activeLocale as Locale}>
        <HashRouter>
          <DesktopRoutesRoot operatorConsole={props.operatorConsole} />
        </HashRouter>
      </I18nProvider>
    </DesktopLanguageContext.Provider>
  );
}

function DesktopRoutesRoot(props: {
  operatorConsole: ComponentType<OperatorConsoleRouteProps>;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <DesktopRoutesController
      api={window.moebius}
      onboardingSaveError={t("desktop.error.onboardingSave")}
      operatorConsole={props.operatorConsole}
    />
  );
}

export function useDesktopLanguage(): DesktopLanguageBundle {
  return useContext(DesktopLanguageContext) ?? FALLBACK_DESKTOP_LANGUAGE;
}
