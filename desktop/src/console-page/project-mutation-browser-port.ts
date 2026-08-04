import { planConsoleEndpoint } from "./console-state-plan.js";
import type {
  ProjectDesktopTransport,
  ProjectMutationPort,
} from "./project-mutation-contract.js";
import { ProjectMutationRequestError } from "./project-mutation-contract.js";

async function readError(response: Response, fallback: string): Promise<void> {
  const body = await response.json() as { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? fallback);
  }
}

async function patchProject(
  apiBase: string,
  projectId: string,
  payload: Record<string, unknown>,
  fallback: string,
): Promise<void> {
  const response = await fetch(planConsoleEndpoint(
    apiBase,
    `/api/local-console/projects/${encodeURIComponent(projectId)}`,
  ), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  await readError(response, fallback);
}

export const browserProjectMutationPort: ProjectMutationPort = {
  async showInFolder(transport: ProjectDesktopTransport | undefined, folderPath: string) {
    if (transport?.showInFolder === undefined) {
      throw new Error("desktop file manager unavailable");
    }
    await transport.showInFolder(folderPath);
  },

  async renameProject(apiBase: string, projectId: string, title: string) {
    await patchProject(apiBase, projectId, { title }, "rename project failed");
  },

  async removeProject(apiBase: string, projectId: string, force: boolean) {
    const response = await fetch(planConsoleEndpoint(
      apiBase,
      `/api/local-console/projects/${encodeURIComponent(projectId)}`,
    ), {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force }),
    });
    const body = await response.json() as { error?: string; code?: string; archivedSessionIds?: string[] };
    if (!response.ok) {
      throw new ProjectMutationRequestError(body.error ?? "remove project failed", body.code);
    }
    return { archivedSessionIds: body.archivedSessionIds };
  },

  async selectFolderForRepair(
    transport: ProjectDesktopTransport | undefined,
    projectId: string,
  ) {
    if (transport?.selectFolderForRepair === undefined) {
      throw new Error("desktop repair folder picker unavailable");
    }
    return transport.selectFolderForRepair(projectId);
  },

  async repairProjectFolder(apiBase: string, projectId: string, folderPath: string) {
    await patchProject(apiBase, projectId, { folderPath }, "repair project folder failed");
  },
};
