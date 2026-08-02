import { useCallback, useMemo } from "react";
import type { Translate } from "@moebius/console-ui";

import type { DesktopApi } from "./desktop-api-contract.js";
import {
  planDesktopActionAvailability,
  planDesktopError,
} from "./desktop-runtime-bridge-model.js";
import type { ConsoleErrorController } from "./use-console-error-state.js";

export function useDesktopShellActions(
  api: DesktopApi | undefined,
  t: Translate,
  errors: ConsoleErrorController,
) {
  const openDiagnostics = useMemo(() => {
    const availability = planDesktopActionAvailability(api?.openStatusPage !== undefined);
    if (availability === "unavailable") return undefined;
    return () => { void api?.openStatusPage?.(); };
  }, [api]);
  const updateClaude = useCallback(() => {
    const availability = planDesktopActionAvailability(api?.startOnboardingClaudeUpdate !== undefined);
    if (availability === "unavailable") {
      errors.report({ family: "desktop-shell", scope: "claude-update" }, t("desktop.error.builderUnavailable"));
      return;
    }
    const operation = errors.begin({ family: "desktop-shell", scope: "claude-update" });
    void api?.startOnboardingClaudeUpdate?.()
      .then(() => errors.succeed(operation))
      .catch((error) => errors.fail(operation, planDesktopError(error)));
  }, [api, errors, t]);
  const openExternalLink = useMemo(() => {
    const availability = planDesktopActionAvailability(api?.openExternalLink !== undefined);
    if (availability === "unavailable") return undefined;
    return (url: string) => {
      const operation = errors.begin({ family: "desktop-shell", scope: `external-link:${url}` });
      void api?.openExternalLink?.(url)
        .then(() => errors.succeed(operation))
        .catch((error) => errors.fail(operation, planDesktopError(error)));
    };
  }, [api, errors]);
  return useMemo(() => ({
    openDiagnostics,
    updateClaude,
    openExternalLink,
  }), [openDiagnostics, openExternalLink, updateClaude]);
}
