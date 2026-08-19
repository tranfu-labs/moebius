import type { AgentRevisionService } from "./agent-revision-service.js";
import type { GithubTeamIpcMain } from "./github-team-ipc.js";
import { createGithubTeamIpcService, registerGithubTeamIpc } from "./github-team-ipc.js";
import { createGithubTeamTransport } from "./github-team-transport.js";
import type { DefaultAgentMergeMember } from "./team-auto-sync.js";

export function wireGithubTeamIpc(input: {
  ipcMain: GithubTeamIpcMain;
  dataRoot: string;
  mergeMember: DefaultAgentMergeMember;
  revisionService: Pick<AgentRevisionService, "recordMemberRevision">;
}): void {
  registerGithubTeamIpc({
    ipcMain: input.ipcMain,
    service: createGithubTeamIpcService({
      dataRoot: input.dataRoot,
      transport: createGithubTeamTransport(),
      mergeMember: input.mergeMember,
      revisionService: input.revisionService,
    }),
  });
}
