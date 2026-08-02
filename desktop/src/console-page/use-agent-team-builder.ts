import { useMemo } from "react";
import type { OperatorAgentTeam, Translate } from "@moebius/console-ui";

import type { AgentTeamListItem } from "../team-ipc-contract.js";
import type { AgentTeamBuilderSessionPort } from "./use-agent-team-builder-session.js";
import { useAgentTeamBuilderSession } from "./use-agent-team-builder-session.js";
import { useAgentTeamBuilderCommands } from "./use-agent-team-builder-commands.js";
import { useAgentTeamBuilderFinalization } from "./use-agent-team-builder-finalization.js";

type BuilderApi = AgentTeamBuilderSessionPort
  & Parameters<typeof useAgentTeamBuilderCommands>[0]["api"]
  & Parameters<typeof useAgentTeamBuilderFinalization>[0]["api"];

export function useAgentTeamBuilderController(input: {
  api: BuilderApi | undefined;
  storage: Storage;
  storageKey: string;
  createDraftId(): string;
  activateCopiedTeam(item: AgentTeamListItem): Promise<string>;
  replaceTeams(teams: OperatorAgentTeam[]): void;
  t: Translate;
}) {
  const sessionBundle = useAgentTeamBuilderSession(input);
  const commandBundle = useAgentTeamBuilderCommands({ api: input.api, session: sessionBundle, t: input.t });
  const finalizationBundle = useAgentTeamBuilderFinalization({
    api: input.api,
    session: sessionBundle,
    start: commandBundle.start,
    t: input.t,
  });
  return useMemo(() => ({
    state: sessionBundle.state,
    onStart: commandBundle.start,
    onSubmit: commandBundle.submit,
    onAdjust: commandBundle.adjust,
    onRetry: finalizationBundle.retry,
    onCommit: finalizationBundle.commit,
  }), [commandBundle, finalizationBundle, sessionBundle.state]);
}
