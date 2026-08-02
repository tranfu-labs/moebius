import {
  relocateUserTeamRecord,
  removeUserTeamRecord,
} from "./team-record-store.js";
import { toListItem, type AgentTeamListItem } from "./team-ipc.js";
import {
  AgentTeamRepairRequestError,
  parseRelocateRequest,
  parseRepairRequest,
} from "./team-desktop-action-plan.js";

export * from "./team-repair-contract.js";
export { AgentTeamRepairRequestError } from "./team-desktop-action-plan.js";

export async function relocateAgentTeamRecord(
  dataRoot: string,
  rawRequest: unknown,
): Promise<AgentTeamListItem> {
  const request = parseRelocateRequest(rawRequest);
  const snapshot = await relocateUserTeamRecord({
    dataRoot,
    teamId: request.teamId,
    directory: request.directory,
  });
  return toListItem(snapshot);
}

export async function removeAgentTeamRecord(dataRoot: string, rawRequest: unknown): Promise<void> {
  const request = parseRepairRequest(rawRequest);
  await removeUserTeamRecord({ dataRoot, teamId: request.teamId });
}
