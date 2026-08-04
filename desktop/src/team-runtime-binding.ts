import type { LocalConsoleAgentFile } from "../../src/local-console/runtime.js";
import type {
  LocalConsoleAgentTeamSnapshot,
  LocalConsoleSessionSummary,
} from "../../src/local-console/types.js";
import {
  resolveEffectiveExecutionProfile,
  type ExecutionProfile,
  type ExecutionProfileBinding,
} from "./team-execution-profile.js";
import type {
  OfficialTeamStateDocumentV1,
} from "./team-management-document-codec.js";
import {
  AgentTeamRosterUnavailableError,
  assertUsableTeamSnapshot,
  deriveAgentTeamHealth,
  orderPrimaryFirst,
  planBoundTeamLocation,
  projectRuntimeTeamIdentity,
  planRosterReadFailure,
  planSessionAgentSource,
  selectMemberExecutionBinding,
  selectOfficialRecommendations,
  selectRuntimeExecutionProfile,
} from "./team-runtime-binding-plan.js";
import type { TeamLocation, TeamSnapshot } from "./team-store.js";
import { finalizeAgentTeamSnapshot } from "../../src/local-console/session-team-snapshot.js";

export interface TeamRuntimeBindingPorts {
  listSharedAgents(dataRoot: string): Promise<LocalConsoleAgentFile[]>;
  resolveSystemLocation(input: { dataRoot: string; teamId: string }): TeamLocation;
  resolveUserLocation(dataRoot: string, teamId: string): Promise<TeamLocation>;
  readSnapshot(location: TeamLocation): Promise<TeamSnapshot>;
  readBindings(input: {
    dataRoot: string;
    ownership: "system" | "user";
    teamId: string;
  }): Promise<Record<string, ExecutionProfileBinding>>;
  readOfficialState(dataRoot: string): Promise<OfficialTeamStateDocumentV1>;
}

export function createTeamRuntimeBindingService(ports: TeamRuntimeBindingPorts) {
  const readBoundTeamSnapshot = async (
    dataRoot: string,
    session: Pick<LocalConsoleSessionSummary, "agentTeamOwnership" | "agentTeamId">,
  ): Promise<TeamSnapshot> => {
    const teamId = session.agentTeamId!;
    const ownership = session.agentTeamOwnership!;
    const locationLoaders = {
      system: async () => ports.resolveSystemLocation({ dataRoot, teamId }),
      user: async () => await ports.resolveUserLocation(dataRoot, teamId),
    };
    try {
      return await ports.readSnapshot(await locationLoaders[planBoundTeamLocation(ownership)]());
    } catch {
      throw new AgentTeamRosterUnavailableError(teamId, "deleted");
    }
  };

  const loadEffectiveProfiles = async (input: {
    dataRoot: string;
    ownership: "system" | "user";
    teamId: string;
    memberSlugs: readonly string[];
  }): Promise<Record<string, ExecutionProfile>> => {
    const bindings = await ports.readBindings(input);
    const officialLoaders = {
      system: async () => (await ports.readOfficialState(input.dataRoot)).teams[input.teamId],
      user: async () => undefined,
    };
    const recommendations = selectOfficialRecommendations({
      ownership: input.ownership,
      official: await officialLoaders[input.ownership](),
    });
    return Object.fromEntries(input.memberSlugs.map((slug) => {
      const binding = selectMemberExecutionBinding({
        binding: bindings[slug],
        recommendation: recommendations[slug],
      });
      return [slug, resolveEffectiveExecutionProfile({
        binding,
        recommendation: recommendations[slug],
      })];
    }));
  };

  return {
    listSessionAgentFiles: async (input: {
      dataRoot: string;
      session: LocalConsoleSessionSummary;
    }): Promise<LocalConsoleAgentFile[]> => {
      const handlers = {
        shared: async () => await ports.listSharedAgents(input.dataRoot),
        team: async () => {
          const snapshot = await readBoundTeamSnapshot(input.dataRoot, input.session);
          assertUsableTeamSnapshot(snapshot, input.session.agentTeamId!);
          return orderPrimaryFirst(snapshot).map((member) => ({
            name: member.slug,
            path: member.agentFile,
          }));
        },
      };
      return handlers[planSessionAgentSource(input.session)]();
    },

    loadAgentTeamSnapshot: async (input: {
      dataRoot: string;
      ownership: "system" | "user";
      teamId: string;
    }): Promise<LocalConsoleAgentTeamSnapshot> => {
      const snapshot = await readBoundTeamSnapshot(input.dataRoot, {
        agentTeamOwnership: input.ownership,
        agentTeamId: input.teamId,
      });
      assertUsableTeamSnapshot(snapshot, input.teamId);
      const profiles = await loadEffectiveProfiles({
        ...input,
        memberSlugs: snapshot.members.map((member) => member.slug),
      });
      return finalizeAgentTeamSnapshot({
        team: projectRuntimeTeamIdentity({ ...input, snapshot }),
        members: orderPrimaryFirst(snapshot).map((member) => ({
          name: member.slug,
          displayName: member.displayName,
          description: member.description,
          agentMarkdown: member.agentMarkdown,
          executionProfile: selectRuntimeExecutionProfile(profiles[member.slug]),
        })),
      }, { capturedAt: new Date().toISOString() });
    },

    resolveSessionAgentTeamHealth: async (input: {
      dataRoot: string;
      session: LocalConsoleSessionSummary;
    }): Promise<{ health: "usable" | "deleted" | "needs-repair"; reason: string | null }> => {
      const handlers = {
        shared: async () => ({ health: "usable" as const, reason: null }),
        team: async () => {
          try {
            const snapshot = await readBoundTeamSnapshot(input.dataRoot, input.session);
            return deriveAgentTeamHealth({ snapshot, teamId: input.session.agentTeamId! });
          } catch (error) {
            const failures = {
              deleted: () => ({
                health: "deleted" as const,
                reason: (error as AgentTeamRosterUnavailableError).message,
              }),
              rethrow: (): never => { throw error; },
            };
            return failures[planRosterReadFailure(error)]();
          }
        },
      };
      return handlers[planSessionAgentSource(input.session)]();
    },
  };
}

export { AgentTeamRosterUnavailableError } from "./team-runtime-binding-plan.js";
