import { useMemo } from "react";
import type { Translate } from "@moebius/console-ui";

import type { loadExecutionProfileRegistry } from "./console-api-client.js";
import type { ConversationSearchPort } from "./use-conversation-search.js";
import type { DesktopApi } from "./desktop-api-contract.js";
import { useActiveCliInstallationsBundle } from "./use-active-cli-installations.js";
import { useConversationSearch } from "./use-conversation-search.js";
import { useDesktopRuntimeBridge } from "./use-desktop-runtime-bridge.js";
import { useDesktopSettingsBundle } from "./use-desktop-settings.js";

export function useDesktopConsoleShell(
  api: DesktopApi | undefined,
  injectedApiBase: string | undefined,
  search: string,
  loadRegistry: typeof loadExecutionProfileRegistry,
  fetch: typeof window.fetch,
  searchPort: ConversationSearchPort,
  t: Translate,
) {
  const runtime = useDesktopRuntimeBridge(api, injectedApiBase, search, loadRegistry, fetch, t);
  const settings = useDesktopSettingsBundle(api);
  const cliInstallations = useActiveCliInstallationsBundle(api);
  const conversationSearch = useConversationSearch({ apiBase: runtime.apiBase, port: searchPort });
  return useMemo(() => ({
    runtime,
    settings,
    cliInstallations,
    conversationSearch,
  }), [cliInstallations, conversationSearch, runtime, settings]);
}
