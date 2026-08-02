import {
  createTeamCatalogService,
  type TeamCatalogPorts,
} from "./team-catalog-service.js";
import {
  createTeamProfileService,
  type TeamProfilePorts,
} from "./team-profile-service.js";

export * from "./team-ipc-contract.js";

export type AgentTeamServicePorts = TeamProfilePorts & Omit<
  TeamCatalogPorts,
  "present" | "copyBindings" | "resolveMemberProfile"
>;

export function createAgentTeamService(ports: AgentTeamServicePorts) {
  const profiles = createTeamProfileService(ports);
  const catalog = createTeamCatalogService({
    ...ports,
    present: profiles.present,
    copyBindings: profiles.copyBindingsAsExplicit,
    resolveMemberProfile: profiles.resolveStoredMemberProfile,
  });
  return { ...catalog, ...profiles };
}
