import { useCallback, useMemo, useState } from "react";
import type { Translate } from "@moebius/console-ui";

import type { DesktopApi } from "./desktop-api-contract.js";
import {
  planDesktopActionAvailability,
  planDesktopError,
} from "./desktop-runtime-bridge-model.js";

export function useDesktopShellActions(api: DesktopApi | undefined, t: Translate) {
  const [clientError, setClientError] = useState<string | null>(null);
  const openDiagnostics = useMemo(() => {
    const availability = planDesktopActionAvailability(api?.openStatusPage !== undefined);
    if (availability === "unavailable") return undefined;
    return () => { void api?.openStatusPage?.(); };
  }, [api]);
  const updateClaude = useCallback(() => {
    const availability = planDesktopActionAvailability(api?.startOnboardingClaudeUpdate !== undefined);
    if (availability === "unavailable") {
      setClientError(t("desktop.error.builderUnavailable"));
      return;
    }
    void api?.startOnboardingClaudeUpdate?.().catch((error) => setClientError(planDesktopError(error)));
  }, [api, t]);
  const openExternalLink = useMemo(() => {
    const availability = planDesktopActionAvailability(api?.openExternalLink !== undefined);
    if (availability === "unavailable") return undefined;
    return (url: string) => {
      void api?.openExternalLink?.(url).catch((error) => setClientError(planDesktopError(error)));
    };
  }, [api]);
  return useMemo(() => ({
    clientError,
    setClientError,
    openDiagnostics,
    updateClaude,
    openExternalLink,
  }), [clientError, openDiagnostics, openExternalLink, updateClaude]);
}
