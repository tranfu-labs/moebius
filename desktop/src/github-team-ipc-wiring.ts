import type { GithubTeamIpcMain } from "./github-team-ipc.js";
import { createGithubTeamIpcService, registerGithubTeamIpc } from "./github-team-ipc.js";
import { createGithubTeamTransport } from "./github-team-transport.js";

export function wireGithubTeamIpc(input: {
  ipcMain: GithubTeamIpcMain;
  dataRoot: string;
}): void {
  registerGithubTeamIpc({
    ipcMain: input.ipcMain,
    service: createGithubTeamIpcService({
      dataRoot: input.dataRoot,
      transport: createGithubTeamTransport(),
    }),
  });
}
