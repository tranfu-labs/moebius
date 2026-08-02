import fs from "node:fs/promises";
import path from "node:path";

import {
  TEAM_AGENT_FILE,
  TEAM_MANIFEST_FILE,
  TEAM_MEMBERS_DIRECTORY,
} from "../team-model.js";
import type { TeamSnapshot } from "../team-store.js";
import type {
  AiTeamStagedReadback,
  AiTeamWriteLocations,
  AiTeamWriteSources,
  AiTeamWriteStorePort,
} from "./team-write-contract.js";

export class AiTeamWriteFileStore implements AiTeamWriteStorePort {
  async prepare(dataRoot: string, teamId: string): Promise<AiTeamWriteLocations> {
    const resolvedDataRoot = path.resolve(dataRoot);
    const teamsRoot = path.join(resolvedDataRoot, "teams");
    const stagingRoot = path.join(resolvedDataRoot, ".state", "ai-team-builder-staging");
    await Promise.all([
      fs.mkdir(teamsRoot, { recursive: true }),
      fs.mkdir(stagingRoot, { recursive: true }),
    ]);
    const [teams, staging] = await Promise.all([fs.stat(teamsRoot), fs.stat(stagingRoot)]);
    return {
      dataRoot: resolvedDataRoot,
      teamId,
      teamsRoot,
      stagingRoot,
      destination: path.join(teamsRoot, teamId),
      teamsDevice: teams.dev,
      stagingDevice: staging.dev,
    };
  }

  async stage(
    locations: AiTeamWriteLocations,
    sources: AiTeamWriteSources,
  ): Promise<AiTeamStagedReadback> {
    const staging = await fs.mkdtemp(path.join(locations.stagingRoot, `${locations.teamId}-`));
    try {
      await fs.writeFile(
        path.join(staging, TEAM_MANIFEST_FILE),
        sources.definitionSource,
        "utf8",
      );
      await fs.writeFile(
        path.join(staging, sources.orchestrationFileName),
        sources.orchestrationSource,
        "utf8",
      );
      for (const member of sources.members) {
        const memberDirectory = path.join(staging, TEAM_MEMBERS_DIRECTORY, member.slug);
        await fs.mkdir(memberDirectory, { recursive: true });
        await fs.writeFile(
          path.join(memberDirectory, TEAM_AGENT_FILE),
          member.agentMarkdown,
          "utf8",
        );
      }
      const members = await Promise.all(sources.members.map(async (member) => {
        const directory = path.join(staging, TEAM_MEMBERS_DIRECTORY, member.slug);
        const agentFile = path.join(directory, TEAM_AGENT_FILE);
        return {
          slug: member.slug,
          directory,
          agentFile,
          agentMarkdown: await fs.readFile(agentFile, "utf8"),
        };
      }));
      return {
        staging,
        destination: locations.destination,
        definitionSource: await fs.readFile(path.join(staging, TEAM_MANIFEST_FILE), "utf8"),
        orchestrationSource: await fs.readFile(
          path.join(staging, sources.orchestrationFileName),
          "utf8",
        ),
        members,
      };
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  async commit(staging: string, destination: string): Promise<void> {
    await fs.rename(staging, destination);
  }

  async remove(target: string): Promise<void> {
    await fs.rm(target, { recursive: true, force: true });
  }

  relocateSnapshot(snapshot: TeamSnapshot, destination: string): TeamSnapshot {
    return {
      ...snapshot,
      location: { ...snapshot.location, directory: destination },
      members: snapshot.members.map((member) => {
        const directory = path.join(destination, TEAM_MEMBERS_DIRECTORY, member.slug);
        return {
          ...member,
          directory,
          agentFile: path.join(directory, TEAM_AGENT_FILE),
        };
      }),
    };
  }
}
