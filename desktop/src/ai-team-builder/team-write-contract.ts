import type { TeamSnapshot } from "../team-store.js";

export interface AiTeamWriteLocations {
  dataRoot: string;
  teamId: string;
  teamsRoot: string;
  stagingRoot: string;
  destination: string;
  teamsDevice: number;
  stagingDevice: number;
}

export interface AiTeamWriteSources {
  definitionSource: string;
  orchestrationFileName: string;
  orchestrationSource: string;
  members: readonly { slug: string; agentMarkdown: string }[];
}

export interface AiTeamStagedMemberReadback {
  slug: string;
  directory: string;
  agentFile: string;
  agentMarkdown: string;
}

export interface AiTeamStagedReadback {
  staging: string;
  destination: string;
  definitionSource: string;
  orchestrationSource: string;
  members: AiTeamStagedMemberReadback[];
}

export interface AiTeamWriteStorePort {
  prepare(dataRoot: string, teamId: string): Promise<AiTeamWriteLocations>;
  stage(
    locations: AiTeamWriteLocations,
    sources: AiTeamWriteSources,
  ): Promise<AiTeamStagedReadback>;
  commit(staging: string, destination: string): Promise<void>;
  remove(target: string): Promise<void>;
  relocateSnapshot(snapshot: TeamSnapshot, destination: string): TeamSnapshot;
}
