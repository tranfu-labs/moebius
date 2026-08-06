import type { TranslationKey } from "@moebius/console-ui";
import type { ProviderSettingsMessages } from "./use-provider-settings.js";

export function buildProviderSettingsMessages(t: (key: TranslationKey) => string): ProviderSettingsMessages {
  return {
    bridgeUnavailable: t("settings.providers.bridgeUnavailable"),
    listFailed: t("settings.providers.listFailed"),
    operationFailed: t("settings.providers.operationFailed"),
  };
}
